import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../lib/config.ts';
import { bypassScan, QUARANTINE } from '../gates/bypass-scan.ts';
import { docLint } from '../gates/doc-lint.ts';
import { planGate } from '../gates/plan-gate.ts';
import { gitignoreProblems } from '../gates/secret-scan.ts';
import { commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

function repo(): string {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  write(
    root,
    'harness.config.json',
    JSON.stringify(fixtureConfig({ docLint: { agentsMdMaxLines: 10, exclude: [] } })),
  );
  write(root, 'AGENTS.md', '# 지도\n\n- [목차](docs/index.md)\n');
  write(
    root,
    'docs/index.md',
    '---\nstatus: active\nrelated_code: []\nreview_cycle: on-change\n---\n# 목차\n\n- [가이드](guide.md)\n',
  );
  write(
    root,
    'docs/guide.md',
    '---\nstatus: active\nrelated_code: []\nreview_cycle: on-change\n---\n# 가이드\n',
  );
  commitAll(root, 'init');
  return root;
}

test('doc-lint: 정상 리포는 통과', () => {
  const root = repo();
  const r = docLint(root, loadConfig(root));
  assert.deepEqual(r.errors, []);
});

test('doc-lint: 깨진 링크, 색인 누락, frontmatter, AGENTS.md 줄 수', () => {
  const root = repo();
  write(
    root,
    'docs/guide.md',
    '---\nstatus: wip\nrelated_code: []\nreview_cycle: on-change\n---\n# 가이드\n[없음](missing.md) `[코드](not-checked.md)`\n',
  );
  write(root, 'docs/orphan.md', '# 고아\n');
  write(root, 'AGENTS.md', Array.from({ length: 12 }, (_, i) => `줄 ${i}`).join('\n'));
  const rules = docLint(root, loadConfig(root)).errors.map((e) => e.rule + ' ' + e.what);
  assert.ok(rules.some((r) => r.includes('깨진 링크') && r.includes('missing.md')));
  assert.ok(
    !rules.some((r) => r.includes('not-checked.md')),
    '인라인 코드 안의 링크는 검사하지 않는다',
  );
  assert.ok(rules.some((r) => r.includes('색인 누락') && r.includes('orphan.md')));
  assert.ok(rules.some((r) => r.includes('frontmatter') && r.includes('status')));
  assert.ok(rules.some((r) => r.includes('frontmatter') && r.includes('orphan.md')));
  assert.ok(rules.some((r) => r.includes('AGENTS.md') && r.includes('상한')));
});

test('doc-lint: related_code가 문서보다 나중에 바뀌면 경고', () => {
  const root = repo();
  write(
    root,
    'docs/guide.md',
    '---\nstatus: active\nrelated_code: [src/]\nreview_cycle: on-change\n---\n# 가이드\n',
  );
  commitAll(root, 'doc');
  write(root, 'src/a.ts', 'x');
  sh('git', ['add', '-A'], root);
  sh('git', ['commit', '-q', '-m', 'code', '--date', '2099-01-01T00:00:00'], root, {
    GIT_COMMITTER_DATE: '2099-01-01T00:00:00',
  });
  const r = docLint(root, loadConfig(root));
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.rule.includes('검토 필요')));
});

const SKIP = 'it.' + 'skip';

test('bypass-scan: 새로 추가된 우회 표시를 찾는다', () => {
  const root = repo();
  const base = sh('git', ['rev-parse', 'HEAD'], root);
  write(root, 'src/a.test.ts', `${SKIP}('x', () => {});\n`);
  const p = bypassScan(root, loadConfig(root), { base, committedOnly: false });
  assert.equal(p.length, 1);
  assert.match(p[0].rule, /R4/);
});

test('bypass-scan: 유효한 격리 주석만 허용하고, 기한이 지나면 실패', () => {
  const root = repo();
  write(
    root,
    'docs/exec-plans/tech-debt-tracker.md',
    '| id | 내용 |\n|---|---|\n| TD-7 | flaky |\n',
  );
  commitAll(root, 'td');
  const base = sh('git', ['rev-parse', 'HEAD'], root);
  write(
    root,
    'src/a.test.ts',
    `// ${QUARANTINE} TD-7 until=2999-01-01 reason="타이밍"\n${SKIP}('x', () => {});\n`,
  );
  assert.equal(bypassScan(root, loadConfig(root), { base, committedOnly: false }).length, 0);
  write(
    root,
    'src/a.test.ts',
    `// ${QUARANTINE} TD-9 until=2999-01-01 reason="없는 TD"\n${SKIP}('x', () => {});\n`,
  );
  assert.ok(bypassScan(root, loadConfig(root), { base, committedOnly: false }).length >= 1);
  write(
    root,
    'src/a.test.ts',
    `// ${QUARANTINE} TD-7 until=2000-01-01 reason="만료"\n${SKIP}('x', () => {});\n`,
  );
  const expired = bypassScan(root, loadConfig(root), { base, committedOnly: false });
  assert.ok(expired.some((p) => p.what.includes('지났다')));
});

test('secret-scan: .gitignore의 .env 항목이 빠지면 실패', () => {
  const root = repo();
  write(root, '.gitignore', 'node_modules/\n');
  assert.equal(gitignoreProblems(root).length, 1);
  write(root, '.gitignore', '.env\n.env.*\n!.env.example\n');
  assert.equal(gitignoreProblems(root).length, 0);
});

// ---------- plan-gate ----------

const PLAN = (status: string) => `---
id: 20261111-demo
issue: 3
type: feat
status: ${status}
size: medium
risk: normal
author: claude-code
owner: runner-1
claimed_at: 2026-11-11T09:00:00+09:00
---
# 데모

## 목표와 수용 기준
- 데모 함수를 만든다

## 범위 / 비범위
- src/demo.ts만

## 관련 파일·문서
- src/demo.ts

## 발견 사항
- 없음

## 검증 방법과 결과
- node --test
`;
const STEP = (n: number, ac: string) =>
  `# Step ${n}: s${n}\n\n## 작업\n- 파일을 만든다\n\n## Acceptance Criteria\n\`\`\`bash\n${ac}\n\`\`\`\n`;
const DIR = 'docs/exec-plans/active/20261111-demo';

function planRepo(): { root: string; base: string } {
  const root = repo();
  const base = sh('git', ['rev-parse', 'HEAD'], root);
  sh('git', ['checkout', '-q', '-b', 'feat/20261111-demo-s0'], root);
  return { root, base };
}

function writePlan(
  root: string,
  steps: { status: string }[],
  planStatus = 'active',
  where = 'active',
) {
  const dir = DIR.replace('/active/', `/${where}/`);
  write(root, `${dir}/plan.md`, PLAN(planStatus));
  write(
    root,
    `${dir}/index.json`,
    JSON.stringify({
      plan: '20261111-demo',
      steps: steps.map((s, i) => ({ step: i, name: `s${i}`, status: s.status })),
    }),
  );
  steps.forEach((_, i) => write(root, `${dir}/step${i}.md`, STEP(i, `test -f s${i}.txt`)));
}

test('plan-gate: 계획 없는 PR은 실패한다 (R1)', () => {
  const { root, base } = planRepo();
  write(root, 'src/demo.ts', 'export {}');
  commitAll(root, 'code');
  const r = planGate({
    root,
    base,
    branch: 'feat/20261111-demo-s0',
    mode: 'pr',
    cfg: loadConfig(root),
  });
  assert.match(r.problems[0].what, /계획 파일이 없다/);
  const bad = planGate({ root, base, branch: 'my-branch', mode: 'pr', cfg: loadConfig(root) });
  assert.match(bad.problems[0].what, /브랜치 이름/);
});

test('plan-gate: 완료 처리된 step PR은 통과, 완료 전이면 실패', () => {
  const { root, base } = planRepo();
  writePlan(root, [{ status: 'in_progress' }, { status: 'pending' }]);
  commitAll(root, 'plan');
  const cfg = loadConfig(root);
  const pending = planGate({ root, base, branch: 'feat/20261111-demo-s0', mode: 'pr', cfg });
  assert.ok(pending.problems.some((p) => p.what.includes('완료 처리 전')));
  assert.equal(
    planGate({ root, base, branch: 'feat/20261111-demo-s0', mode: 'plan', cfg }).problems.length,
    0,
  );
  writePlan(root, [{ status: 'completed' }, { status: 'pending' }]);
  assert.deepEqual(
    planGate({ root, base, branch: 'feat/20261111-demo-s0', mode: 'pr', cfg }).problems,
    [],
  );
});

test('plan-gate: 필수 섹션·AC·발견 사항 처리', () => {
  const { root, base } = planRepo();
  writePlan(root, [{ status: 'completed' }, { status: 'pending' }]);
  write(
    root,
    `${DIR}/plan.md`,
    PLAN('active')
      .replace('- 데모 함수를 만든다', '<!-- 비어 있음 -->')
      .replace('- 없음', '- 예상 밖 동작'),
  );
  write(root, `${DIR}/step1.md`, STEP(1, '# 명령 없음'));
  const what = planGate({
    root,
    base,
    branch: 'feat/20261111-demo-s0',
    mode: 'pr',
    cfg: loadConfig(root),
  })
    .problems.map((p) => p.what)
    .join('\n');
  assert.match(what, /목표와 수용 기준/);
  assert.match(what, /step1\.md의 Acceptance Criteria/);
  assert.match(what, /발견 사항 1건/);
});

test('plan-gate: 자기 step의 AC를 바꾼 PR은 실패한다', () => {
  const { root } = planRepo();
  writePlan(root, [{ status: 'completed' }, { status: 'pending' }]);
  commitAll(root, 'step0');
  sh('git', ['checkout', '-q', 'main'], root);
  sh('git', ['merge', '-q', '--squash', 'feat/20261111-demo-s0'], root);
  const base = commitAll(root, 'merge step0');
  sh('git', ['checkout', '-q', '-b', 'feat/20261111-demo-s1'], root);
  sh('git', ['rm', '-q', '-r', DIR], root);
  writePlan(root, [{ status: 'completed' }, { status: 'completed' }], 'completed', 'completed');
  const cdir = DIR.replace('/active/', '/completed/');
  const cfg = loadConfig(root);
  assert.deepEqual(
    planGate({ root, base, branch: 'feat/20261111-demo-s1', mode: 'pr', cfg }).problems,
    [],
  );
  write(root, `${cdir}/step1.md`, STEP(1, 'true'));
  const r = planGate({ root, base, branch: 'feat/20261111-demo-s1', mode: 'pr', cfg });
  assert.ok(r.problems.some((p) => p.what.includes('step1의 Acceptance Criteria')));
});
