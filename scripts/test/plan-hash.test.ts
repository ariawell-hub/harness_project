// 계획 해시와 계획 전용 PR 판정(G1, 10.3절 승인 결속 기준). 계획 20261115-review-ledger step4.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { planHash, planHashAt, planHashes, planMode } from '../ci/plan-hash.ts';
import { commitAll, gitInit, sh, tmp, write } from './helpers.ts';

const ID = '20261111-demo';
const DIR = `docs/exec-plans/active/${ID}`;
const DONE = `docs/exec-plans/completed/${ID}`;
const BRANCH = `feat/${ID}-s0`;

interface PlanText {
  status?: string;
  goal?: string;
  scope?: string;
  files?: string;
  log?: string;
}
const PLAN = (o: PlanText = {}) => `---
id: ${ID}
issue: 3
type: feat
status: ${o.status ?? 'active'}
size: medium
risk: normal
author: claude-code
owner: runner-1
claimed_at: 2026-11-11T09:00:00+09:00
---
# 데모

## 목표와 수용 기준

${o.goal ?? '- 데모 함수를 만든다'}

## 범위 / 비범위

${o.scope ?? '- src/demo.ts만'}

## 관련 파일·문서

${o.files ?? '- src/demo.ts'}

## 진행 로그

${o.log ?? '- 시작'}

## 발견 사항

- 없음

## 검증 방법과 결과

- node --test
`;
const STEP = (n: number, o: { work?: string; ac?: string; read?: string; ban?: string } = {}) =>
  `# Step ${n}: s${n}\n\n## 읽어야 할 파일\n\n${o.read ?? '- 없음'}\n\n## 작업\n\n${o.work ?? '- 파일을 만든다'}\n\n## Acceptance Criteria\n\n\`\`\`bash\n${o.ac ?? `test -f s${n}.txt`}\n\`\`\`\n\n## 금지사항\n\n${o.ban ?? '- 없음'}\n`;
const INDEX = (statuses: string[]) =>
  JSON.stringify({
    plan: ID,
    steps: statuses.map((status, i) => ({ step: i, name: `s${i}`, status })),
  });

function planDir(dir = DIR): string {
  const root = tmp();
  write(root, `${dir}/plan.md`, PLAN());
  write(root, `${dir}/index.json`, INDEX(['pending', 'pending']));
  write(root, `${dir}/step0.md`, STEP(0));
  write(root, `${dir}/step1.md`, STEP(1));
  return root;
}

test('planHash: 진행 로그·상태·위치·줄 끝 공백이 바뀌어도 같다', () => {
  const root = planDir();
  const h = planHash(root, DIR);
  assert.match(h, /^[0-9a-f]{64}$/);
  // 진행 로그, frontmatter status, index.json 상태
  write(root, `${DIR}/plan.md`, PLAN({ status: 'completed', log: '- 시작\n- step0 완료' }));
  write(root, `${DIR}/index.json`, INDEX(['completed', 'in_progress']));
  assert.equal(planHash(root, DIR), h);
  // 해시에 들어가지 않는 step 섹션(안내용 "읽어야 할 파일")
  write(root, `${DIR}/step0.md`, STEP(0, { read: '- docs/a.md' }));
  assert.equal(planHash(root, DIR), h);
  // 줄 끝 공백, CRLF, 섹션 앞뒤 빈 줄
  write(
    root,
    `${DIR}/plan.md`,
    PLAN({ goal: '\n- 데모 함수를 만든다   \n\n' }).replace(/\n/g, '\r\n'),
  );
  assert.equal(planHash(root, DIR), h);
  // 위치: active/ → completed/
  const moved = planDir(DONE);
  assert.equal(planHash(moved, DONE), h);
});

test('planHash: 목표·범위·관련 파일, step의 작업·AC·금지사항, step 파일 수가 바뀌면 다르다', () => {
  const base = planHash(planDir(), DIR);
  const changed: [string, (root: string) => void][] = [
    ['목표', (r) => write(r, `${DIR}/plan.md`, PLAN({ goal: '- 데모 함수를 둘 만든다' }))],
    ['범위', (r) => write(r, `${DIR}/plan.md`, PLAN({ scope: '- src/ 전체' }))],
    ['관련 파일', (r) => write(r, `${DIR}/plan.md`, PLAN({ files: '- src/demo.ts\n- src/x.ts' }))],
    ['작업', (r) => write(r, `${DIR}/step1.md`, STEP(1, { work: '- 파일을 지운다' }))],
    ['AC', (r) => write(r, `${DIR}/step1.md`, STEP(1, { ac: 'true' }))],
    ['AC 줄 안 공백', (r) => write(r, `${DIR}/step1.md`, STEP(1, { ac: 'test  -f s1.txt' }))],
    // 승인 뒤 금지사항을 지우거나 고치는 것도 계획 수정이다(PR #87 F2)
    ['금지사항', (r) => write(r, `${DIR}/step1.md`, STEP(1, { ban: '- X를 하지 마라. 이유: Y' }))],
    [
      '금지사항 섹션 삭제',
      (r) => write(r, `${DIR}/step1.md`, STEP(1).replace(/\n## 금지사항[\s\S]*$/, '')),
    ],
    ['새 step', (r) => write(r, `${DIR}/step2.md`, STEP(2))],
    // 같은 내용이라도 다른 step에 있으면 다른 계획이다
    [
      'step 내용 맞바꿈',
      (r) => {
        write(r, `${DIR}/step0.md`, STEP(0, { ac: 'test -f s1.txt' }));
        write(r, `${DIR}/step1.md`, STEP(1, { ac: 'test -f s0.txt' }));
      },
    ],
  ];
  const seen = new Set([base]);
  for (const [name, change] of changed) {
    const root = planDir();
    change(root);
    const h = planHash(root, DIR);
    assert.ok(!seen.has(h), `${name}을 바꿔도 해시가 같다`);
    seen.add(h);
  }
  // step 파일은 번호순이다(step10이 step2 앞에 오지 않는다). 이름이 step<N>.md가 아닌 파일은 넣지 않는다
  const a = planDir();
  write(a, `${DIR}/step2.md`, STEP(2));
  write(a, `${DIR}/step10.md`, STEP(10));
  const withTen = planHash(a, DIR);
  write(a, `${DIR}/notes.md`, '## 작업\n\n- 딴 글\n');
  write(a, `${DIR}/step1.md.bak`, STEP(1, { ac: 'false' }));
  assert.equal(planHash(a, DIR), withTen);
  assert.throws(() => planHash(tmp(), DIR), /plan\.md/);
});

function prRepo(): { root: string; base: string } {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'README.md', '# r\n');
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', BRANCH], root);
  write(root, `${DIR}/plan.md`, PLAN());
  write(root, `${DIR}/index.json`, INDEX(['pending', 'pending']));
  write(root, `${DIR}/step0.md`, STEP(0));
  write(root, `${DIR}/step1.md`, STEP(1));
  commitAll(root, 'plan');
  return { root, base };
}

test('planHashAt·planHashes: 커밋의 계획 해시를 읽는다. 계획이 없는 커밋은 null', () => {
  const { root, base } = prRepo();
  const h = planHash(root, DIR);
  assert.equal(planHashAt(root, 'HEAD', DIR), h);
  assert.equal(planHashAt(root, base, DIR), null);
  assert.deepEqual(planHashes(root, base, BRANCH), { hash: h, baseHash: null });

  // 다음 step의 PR: 계획이 base에 있고, 완료 처리로 completed/로 옮겨도 해시가 같다
  const merged = sh('git', ['rev-parse', 'HEAD'], root);
  sh('git', ['checkout', '-q', '-b', `feat/${ID}-s1`], root);
  mkdirSync(path.join(root, path.dirname(DONE)), { recursive: true });
  sh('git', ['mv', DIR, DONE], root);
  write(root, `${DONE}/plan.md`, PLAN({ status: 'completed', log: '- 끝' }));
  commitAll(root, 'complete');
  assert.deepEqual(planHashes(root, merged, `feat/${ID}-s1`), { hash: h, baseHash: h });
  // 작업 트리에서 다른 step의 AC를 고치면 달라진다
  write(root, `${DONE}/step0.md`, STEP(0, { ac: 'true' }));
  const now = planHashes(root, merged, `feat/${ID}-s1`);
  assert.equal(now?.baseHash, h);
  assert.notEqual(now?.hash, h);
  // 계획 폴더가 없는 브랜치(소규모 계획, 계획 없음, 규칙 밖 이름)
  assert.equal(planHashes(root, merged, 'feat/20261111-other-s0'), null);
  assert.equal(planHashes(root, merged, 'my-branch'), null);
});

test('planMode: PR이 바꾼 파일이 이 계획 폴더 안뿐이면 plan, 그 밖은 code', () => {
  const { root, base } = prRepo();
  assert.deepEqual(planMode({ root, base, branch: BRANCH }), {
    mode: 'plan',
    hash: planHash(root, DIR),
  });
  // 진행 로그만 고친 커밋을 더해도 계획 전용이다
  write(root, `${DIR}/plan.md`, PLAN({ log: '- 시작\n- 검증 요청' }));
  commitAll(root, 'log');
  assert.equal(planMode({ root, base, branch: BRANCH }).mode, 'plan');

  // 코드가 섞이면 code. 해시는 그대로 낸다
  write(root, 'src/demo.ts', 'export {}\n');
  const code = commitAll(root, 'code');
  const mixed = planMode({ root, base, branch: BRANCH });
  assert.equal(mixed.mode, 'code');
  assert.equal(mixed.hash, planHash(root, DIR));
  // 코드를 되돌리는 커밋을 올리면 PR 전체 변경이 다시 계획뿐이다
  sh('git', ['revert', '--no-edit', code], root);
  assert.equal(planMode({ root, base, branch: BRANCH }).mode, 'plan');

  // 다른 계획의 폴더, 계획 폴더 밖의 문서는 계획 전용이 아니다
  write(root, 'docs/exec-plans/active/20261111-other/plan.md', PLAN());
  commitAll(root, 'other plan');
  assert.equal(planMode({ root, base, branch: BRANCH }).mode, 'code');
});

test('planMode: 바뀐 파일이 없거나 계획 폴더가 없으면 code이고 해시가 없다', () => {
  const { root, base } = prRepo();
  const head = sh('git', ['rev-parse', 'HEAD'], root);
  // 바뀐 파일 없음(base = head)
  assert.equal(planMode({ root, base: head, branch: BRANCH }).mode, 'code');
  // 소규모 계획(단일 파일)과 규칙 밖 브랜치
  write(root, 'docs/exec-plans/active/20261111-small.md', PLAN());
  commitAll(root, 'small');
  assert.deepEqual(planMode({ root, base, branch: 'docs/20261111-small' }), {
    mode: 'code',
    hash: '',
  });
  assert.deepEqual(planMode({ root, base, branch: 'my-branch' }), { mode: 'code', hash: '' });
  // base를 읽지 못하면 계획 전용으로 보지 않는다
  assert.equal(planMode({ root, base: 'f'.repeat(40), branch: BRANCH }).mode, 'code');
});
