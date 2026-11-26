// PR 트리의 계획 자리에 심볼릭 링크가 있으면 계획을 읽는 판정 코드가 링크 대상을 읽지 않는다(Issue #194).
// 판정 코드의 기존 함수만 부른다(새 모듈을 import하지 않는다): 변경 전 코드에서는 링크 대상을 읽어 단언으로 실패한다.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { planHash, planHashAt, planHashes, planMode } from '../ci/plan-hash.ts';
import { REVIEW_DIR, writeReviewInput } from '../ci/review-input.ts';
import { planAuthor, planReview } from '../ci/review-plan.ts';
import { planGate } from '../gates/plan-gate.ts';
import { assessRisk, riskGate } from '../gates/risk-gate.ts';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { commitAll, fixtureConfig, gitInit, HARNESS_ROOT, sh, tmp, write } from './helpers.ts';

const ID = '20261111-linkplan';
const DIR = `docs/exec-plans/active/${ID}`;
const BRANCH = `fix/${ID}-s0`;
const MARKER = 'LINK-TARGET-MARKER';

const PLAN = (risk: string, author: string, extra = '') => `---
id: ${ID}
issue: 3
type: fix
status: active
size: medium
risk: ${risk}
author: ${author}
owner: session
claimed_at: 2026-11-11T09:00:00+09:00
---
# 링크 시험${extra}

## 목표와 수용 기준
- 데모 함수를 만든다${extra}

## 범위 / 비범위
- src/demo.ts만

## 관련 파일·문서
- \`src/demo.ts\`

## 발견 사항
- 없음

## 검증 방법과 결과
- node --test
`;
const INDEX = JSON.stringify({ plan: ID, steps: [{ step: 0, name: 's0', status: 'pending' }] });
const STEP = (extra = '') =>
  `# Step 0: s0\n\n## 작업\n- 파일을 만든다${extra}\n\n## Acceptance Criteria\n\`\`\`bash\ntest -f s0.txt\n\`\`\`\n`;

/** 리포 밖의 "그럴듯한 계획": 위험도 낮음, Codex가 씀, 표식 글 */
function outsidePlan(): string {
  const dir = path.join(tmp(), 'outside-plan');
  write(dir, 'plan.md', PLAN('low', 'codex', ` ${MARKER}`));
  write(dir, 'index.json', INDEX);
  write(dir, 'step0.md', STEP(` ${MARKER}`));
  return dir;
}

interface Fixture {
  root: string;
  base: string;
  cfg: HarnessConfig;
}

/** 정상 계획(위험도 높음, Claude Code가 씀)을 커밋한 브랜치. 커밋은 하지 않을 수도 있다 */
function planRepo(commit = true): Fixture {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig()));
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', BRANCH], root);
  write(root, `${DIR}/plan.md`, PLAN('high', 'claude-code'));
  write(root, `${DIR}/index.json`, INDEX);
  write(root, `${DIR}/step0.md`, STEP());
  if (commit) commitAll(root, 'plan');
  return { root, base, cfg: loadConfig(root) };
}

type Kind =
  | 'plan-file'
  | 'plan-dir'
  | 'index'
  | 'step'
  | 'plan-file-nolinks'
  | 'plan-dir-nolinks'
  | 'step-index-only';

/** 링크 꼴마다의 픽스처와 그 자리(리포 기준 경로). 파일 링크를 만들 권한이 없으면 null(개발자 모드가 꺼진 Windows) */
function linked(kind: Kind): (Fixture & { place: string }) | null {
  const out = outsidePlan();
  const fx = planRepo();
  const at = (rel: string) => path.join(fx.root, rel);
  const fileLink = (rel: string, target: string): boolean => {
    rmSync(at(rel));
    try {
      symlinkSync(target, at(rel), 'file');
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
      return false;
    }
  };
  switch (kind) {
    case 'plan-file':
      if (!fileLink(`${DIR}/plan.md`, path.join(out, 'plan.md'))) return null;
      commitAll(fx.root, 'link');
      return { ...fx, place: `${DIR}/plan.md` };
    case 'index':
      if (!fileLink(`${DIR}/index.json`, path.join(out, 'index.json'))) return null;
      commitAll(fx.root, 'link');
      return { ...fx, place: `${DIR}/index.json` };
    case 'step':
      if (!fileLink(`${DIR}/step0.md`, path.join(out, 'step0.md'))) return null;
      commitAll(fx.root, 'link');
      return { ...fx, place: `${DIR}/step0.md` };
    case 'plan-dir':
      rmSync(at(DIR), { recursive: true });
      // 폴더 링크는 Windows에서도 권한 없이 만들 수 있는 정션으로 만든다
      symlinkSync(out, at(DIR), 'junction');
      commitAll(fx.root, 'link');
      return { ...fx, place: DIR };
    case 'step-index-only': {
      // step 파일을 작업 트리에서 지우고 색인에만 링크로 둔다: 작업 트리 목록으로는 step 파일이 보이지 않는다
      const rel = `${DIR}/step0.md`;
      rmSync(at(rel));
      const blob = runSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: fx.root,
        input: path.join(out, 'step0.md'),
      }).stdout.trim();
      sh('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},${rel}`], fx.root);
      sh('git', ['commit', '-q', '-m', 'link'], fx.root);
      return { ...fx, place: rel };
    }
    case 'plan-file-nolinks':
    case 'plan-dir-nolinks': {
      // 링크를 git 색인에만 만들어 커밋하고(링크를 만들 권한이 없어도 된다), core.symlinks=false로 받는다:
      // 받은 작업 트리에서는 링크가 대상 경로를 글로 담은 일반 파일이다(CI의 PR 체크아웃과 같다)
      const rel = kind === 'plan-file-nolinks' ? `${DIR}/plan.md` : DIR;
      const target = kind === 'plan-file-nolinks' ? path.join(out, 'plan.md') : out;
      const blob = runSync('git', ['hash-object', '-w', '--stdin'], {
        cwd: fx.root,
        input: target,
      }).stdout.trim();
      if (kind === 'plan-dir-nolinks') sh('git', ['rm', '-r', '-q', '--cached', DIR], fx.root);
      sh('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},${rel}`], fx.root);
      sh('git', ['commit', '-q', '-m', 'link'], fx.root);
      const clone = path.join(tmp(), 'clone');
      sh(
        'git',
        ['clone', '-q', '-c', 'core.symlinks=false', '--branch', BRANCH, fx.root, clone],
        tmp(),
      );
      assert.equal(
        sh('git', ['ls-files', '-s', '--', rel], clone).split(' ')[0],
        '120000',
        '색인에 링크로 있어야 한다',
      );
      return { root: clone, base: fx.base, cfg: loadConfig(clone), place: rel };
    }
  }
}

/** gates가 risk-gate를 부르는 방식: 던지면 error(scripts/ci/gates.ts의 guarded) */
function riskGateLikeGates(fx: Fixture): string {
  try {
    return riskGate({
      root: fx.root,
      base: fx.base,
      branch: BRANCH,
      cfg: fx.cfg,
      signals: [],
      headSha: 'f'.repeat(40),
      reviews: [],
    }).state;
  } catch {
    return 'error';
  }
}

function contextOf(fx: Fixture): string {
  writeReviewInput({ root: fx.root, base: fx.base, branch: BRANCH, risk: 'high', reasons: [] });
  return readFileSync(path.join(fx.root, REVIEW_DIR, 'context.md'), 'utf8');
}

const LINK_PROBLEM = '계획 자리가 일반 파일·폴더가 아니다';

function assertRejected(fx: Fixture & { place: string }, planLevel: boolean, label: string): void {
  const seen: string[] = [];
  for (const mode of ['pr', 'plan'] as const) {
    const r = planGate({ root: fx.root, base: fx.base, branch: BRANCH, mode, cfg: fx.cfg });
    const text = JSON.stringify(r.problems);
    seen.push(text);
    assert.ok(
      r.problems.some(
        (p) => JSON.stringify(p).includes(LINK_PROBLEM) && JSON.stringify(p).includes(fx.place),
      ),
      `${label} · planGate(${mode}): 링크 자리 문제가 없다: ${text}`,
    );
  }
  assert.throws(() => planHash(fx.root, DIR), `${label}: planHash가 던지지 않았다`);
  assert.throws(() => planHashes(fx.root, fx.base, BRANCH), `${label}: planHashes가 던지지 않았다`);
  assert.deepEqual(planMode({ root: fx.root, base: fx.base, branch: BRANCH }), {
    mode: 'code',
    hash: '',
  });
  const ctx = contextOf(fx);
  seen.push(ctx);
  assert.match(ctx, /읽지 않음/, `${label}: context.md: ${ctx}`);
  if (planLevel) {
    assert.throws(
      () => assessRisk({ root: fx.root, base: fx.base, branch: BRANCH, cfg: fx.cfg, signals: [] }),
      `${label}: assessRisk가 던지지 않았다`,
    );
    assert.notEqual(riskGateLikeGates(fx), 'success', `${label}: risk-gate가 통과했다`);
    assert.equal(planAuthor(fx.root, BRANCH), '', `${label}: planAuthor`);
  } else {
    const r = assessRisk({
      root: fx.root,
      base: fx.base,
      branch: BRANCH,
      cfg: fx.cfg,
      signals: [],
    });
    seen.push(JSON.stringify(r));
    assert.equal(r.risk, 'high', `${label}: 정상 계획의 위험도`);
    assert.equal(planAuthor(fx.root, BRANCH), 'claude-code', `${label}: 정상 계획의 작성자`);
  }
  const all = seen.join('\n');
  for (const leak of [MARKER, 'risk: low', 'author: codex'])
    assert.ok(!all.includes(leak), `${label}: 링크 대상의 글(${leak})이 결과에 나왔다`);
}

for (const [kind, planLevel, label] of [
  ['plan-file', true, '(가) plan.md 파일 링크'],
  ['plan-dir', true, '(나) 계획 폴더 링크'],
  ['index', false, '(다) index.json 파일 링크'],
  ['step', false, '(라) step0.md 파일 링크'],
  ['plan-file-nolinks', true, '(마) plan.md 링크를 core.symlinks=false로 받음'],
  ['plan-dir-nolinks', true, '(바) 계획 폴더 링크를 core.symlinks=false로 받음'],
  ['step-index-only', false, '(사) step0.md가 작업 트리에 없고 색인에만 링크로 있음'],
] as const) {
  test(`계획 자리의 링크를 따라가지 않는다: ${label}`, () => {
    const fx = linked(kind);
    // 파일 링크를 만들 권한이 없는 환경(개발자 모드가 꺼진 Windows)에서는 이 꼴만 건너뛴다
    if (!fx) return;
    assertRejected(fx, planLevel, label);
  });
}

test('숫자로 바꾸면 이름이 달라지는 step 링크도 원래 경로를 적어 거절한다', () => {
  const fx = planRepo();
  // index.json은 step0만 적는다. 이 이름의 번호는 Number로 바꾸면 9007199254740992가 된다
  const rel = `${DIR}/step9007199254740993.md`;
  const blob = runSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: fx.root,
    input: path.join(outsidePlan(), 'step0.md'),
  }).stdout.trim();
  sh('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},${rel}`], fx.root);
  sh('git', ['commit', '-q', '-m', 'big step link'], fx.root);
  const place = new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  assert.throws(() => planHash(fx.root, DIR), place);
  assert.throws(() => planHashes(fx.root, fx.base, BRANCH), place);
  assert.deepEqual(planMode({ root: fx.root, base: fx.base, branch: BRANCH }), {
    mode: 'code',
    hash: '',
  });
});

test('읽지 않는 자리의 링크(대조): 계획 폴더의 참고 파일 링크는 해시·모드·plan-gate를 바꾸지 않는다', () => {
  const fx = planRepo();
  // 참고 파일 notes.md를 작업 트리에 두지 않고 색인에만 링크로 커밋한다(링크를 만들 권한이 없어도 된다)
  const rel = `${DIR}/notes.md`;
  const blob = runSync('git', ['hash-object', '-w', '--stdin'], {
    cwd: fx.root,
    input: path.join(outsidePlan(), 'plan.md'),
  }).stdout.trim();
  sh('git', ['update-index', '--add', '--cacheinfo', `120000,${blob},${rel}`], fx.root);
  sh('git', ['commit', '-q', '-m', 'notes link'], fx.root);
  const hash = planHash(fx.root, DIR);
  assert.equal(hash, planHashAt(fx.root, 'HEAD', DIR));
  assert.deepEqual(planMode({ root: fx.root, base: fx.base, branch: BRANCH }), {
    mode: 'plan',
    hash,
  });
  const r = planGate({ root: fx.root, base: fx.base, branch: BRANCH, mode: 'plan', cfg: fx.cfg });
  assert.deepEqual(r.problems, []);
});

test('리포 폴더 자체가 링크(정션)면 링크를 거쳐 계획을 읽지 않는다', () => {
  const fx = planRepo();
  const link = path.join(tmp(), 'pr-link');
  symlinkSync(fx.root, link, 'junction');
  const r = planGate({ root: link, base: fx.base, branch: BRANCH, mode: 'plan', cfg: fx.cfg });
  assert.ok(
    r.problems.some((p) => JSON.stringify(p).includes(LINK_PROBLEM)),
    `링크 자리 문제가 없다: ${JSON.stringify(r.problems)}`,
  );
  assert.throws(() => planHash(link, DIR));
  assert.equal(planAuthor(link, BRANCH), '');
  // 링크 대상의 색인이 깨져 있어도 리포 폴더 자체의 링크로 막는다(git 오류가 아니다)
  writeFileSync(path.join(fx.root, '.git', 'index'), 'garbage');
  const broken = planGate({ root: link, base: fx.base, branch: BRANCH, mode: 'plan', cfg: fx.cfg });
  assert.ok(
    broken.problems.some((p) => JSON.stringify(p).includes(LINK_PROBLEM)),
    `링크 자리 문제가 없다: ${JSON.stringify(broken.problems)}`,
  );
});

test('git 색인을 읽지 못하면 planReview는 던지지 않고 위험도 high·작성자 모름·두 검증자다', () => {
  const fx = planRepo();
  writeFileSync(path.join(fx.root, '.git', 'index'), 'garbage');
  assert.equal(planAuthor(fx.root, BRANCH), '');
  const r = planReview({ root: fx.root, cfg: fx.cfg, base: fx.base, branch: BRANCH });
  assert.equal(r.risk, 'high');
  assert.equal(r.author, '');
  assert.equal(r.claude, true);
  assert.equal(r.codex, true);
});

test('링크 없는 같은 계획(대조): 통과하고 정상 계획의 값을 읽는다', () => {
  const fx = planRepo();
  const r = planGate({ root: fx.root, base: fx.base, branch: BRANCH, mode: 'plan', cfg: fx.cfg });
  assert.deepEqual(r.problems, []);
  const risk = assessRisk({
    root: fx.root,
    base: fx.base,
    branch: BRANCH,
    cfg: fx.cfg,
    signals: [],
  });
  assert.equal(risk.risk, 'high');
  assert.equal(planAuthor(fx.root, BRANCH), 'claude-code');
  assert.equal(planHash(fx.root, DIR), planHashAt(fx.root, 'HEAD', DIR));
  assert.match(contextOf(fx), new RegExp(`계획: ${DIR}/plan\\.md`));
});

test('커밋하지 않은 계획도 전처럼 읽는다(로컬 plan-gate --mode plan)', () => {
  const fx = planRepo(false);
  assert.match(sh('git', ['status', '--porcelain'], fx.root), /\?\? docs\//);
  const r = planGate({ root: fx.root, base: fx.base, branch: BRANCH, mode: 'plan', cfg: fx.cfg });
  assert.deepEqual(r.problems, []);
  assert.match(planHash(fx.root, DIR), /^[0-9a-f]{64}$/);
});

test('이 리포의 계획 해시가 HEAD 커밋의 해시와 같다(읽는 방식을 바꿔도 승인된 계획이 그대로다)', () => {
  let compared = 0;
  for (const where of ['active', 'completed']) {
    const parent = path.join(HARNESS_ROOT, 'docs', 'exec-plans', where);
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent)) {
      const dir = `docs/exec-plans/${where}/${name}`;
      if (!existsSync(path.join(HARNESS_ROOT, dir, 'plan.md'))) continue;
      // HEAD에 있고 작업 트리에서 바뀌지 않은 계획만 견준다
      const atHead = planHashAt(HARNESS_ROOT, 'HEAD', dir);
      const dirty = runSync('git', ['status', '--porcelain', '--', dir], { cwd: HARNESS_ROOT });
      if (atHead === null || dirty.code !== 0 || dirty.stdout.trim()) continue;
      assert.equal(planHash(HARNESS_ROOT, dir), atHead, dir);
      compared++;
    }
  }
  assert.ok(compared > 0, '견준 계획이 없다');
});
