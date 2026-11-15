// CI 기계 판정 결과 조립·기록(scripts/ci/)과 gates 워크플로 불변식. 계획 20261114-ci-gates step0.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { runGates, summaryMarkdown } from '../ci/gates.ts';
import { recordStatuses } from '../ci/record.ts';
import {
  GATE_CONTEXTS,
  toStatuses,
  validateResults,
  type GateResults,
  type StatusPayload,
} from '../ci/results.ts';
import { HARNESS_ROOT, commitAll, fixtureConfig, gitInit, sh, tmp, write } from './helpers.ts';

const SHA = 'a'.repeat(40);

const PLAN = `---
id: 20261114-demo
issue: 3
type: feat
status: active
size: medium
risk: normal
author: claude-code
owner: runner-1
claimed_at: 2026-11-14T09:00:00+09:00
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
const DIR = 'docs/exec-plans/active/20261114-demo';
const BRANCH = 'feat/20261114-demo-s0';

function prRepo(): { root: string; base: string; head: string } {
  const root = path.join(tmp(), 'pr');
  gitInit(root);
  write(root, 'harness.config.json', JSON.stringify(fixtureConfig()));
  const base = commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', BRANCH], root);
  write(root, `${DIR}/plan.md`, PLAN);
  write(
    root,
    `${DIR}/index.json`,
    JSON.stringify({
      plan: '20261114-demo',
      steps: [
        { step: 0, name: 's0', status: 'completed' },
        { step: 1, name: 's1', status: 'pending' },
      ],
    }),
  );
  for (const n of [0, 1])
    write(
      root,
      `${DIR}/step${n}.md`,
      `# Step ${n}: s${n}\n\n## 작업\n- 만든다\n\n## Acceptance Criteria\n\`\`\`bash\ntrue\n\`\`\`\n`,
    );
  write(root, 'src/demo.ts', 'export {}\n');
  const head = commitAll(root, 'step0');
  return { root, base, head };
}

function results(over: Partial<GateResults> = {}): GateResults {
  return {
    version: 1,
    headSha: SHA,
    results: GATE_CONTEXTS.map((context) => ({
      context,
      state: 'success' as const,
      description: '통과',
      details: [],
    })),
    ...over,
  };
}

// ---------- runGates ----------

test('runGates: 계획이 있는 step 브랜치는 plan-gate success, head SHA를 담는다', async () => {
  const { root, base, head } = prRepo();
  const r = await runGates({ root, cfg: loadConfig(root), base, branch: BRANCH, headSha: head });
  assert.equal(r.version, 1);
  assert.equal(r.headSha, head);
  const pg = r.results.find((x) => x.context === 'plan-gate')!;
  assert.equal(pg.state, 'success', pg.details.join('\n'));
});

test('runGates: 계획 없는 브랜치는 plan-gate failure, 첫 문제와 건수를 description에', async () => {
  const { root, base, head } = prRepo();
  const r = await runGates({
    root,
    cfg: loadConfig(root),
    base,
    branch: 'feat/20261114-other-s0',
    headSha: head,
  });
  const pg = r.results.find((x) => x.context === 'plan-gate')!;
  assert.equal(pg.state, 'failure');
  assert.match(pg.description, /계획 파일이 없다/);
  assert.ok(pg.details.length >= 1);
  assert.match(summaryMarkdown(r), /plan-gate/);
});

test('runGates: 검사가 예외를 던지면 그 context만 error', async () => {
  const { root, base, head } = prRepo();
  // planReview가 빠진 설정으로 plan-gate 안에서 TypeError를 일으킨다
  const cfg = { ...loadConfig(root), planReview: undefined } as unknown as HarnessConfig;
  const r = await runGates({ root, cfg, base, branch: BRANCH, headSha: head });
  const pg = r.results.find((x) => x.context === 'plan-gate')!;
  assert.equal(pg.state, 'error');
  assert.ok(pg.description.length > 0);
  assert.deepEqual(
    r.results.map((x) => x.context),
    [...GATE_CONTEXTS],
  );
});

// ---------- validateResults / toStatuses ----------

test('validateResults: 정상 결과는 통과', () => {
  const v = validateResults(results(), { headSha: SHA, contexts: GATE_CONTEXTS });
  assert.equal(v.ok, true);
});

test('validateResults: 형식·context·state·head SHA가 어긋나면 거부', () => {
  const o = { headSha: SHA, contexts: GATE_CONTEXTS };
  const bad: unknown[] = [
    null,
    'text',
    { ...results(), version: 2 },
    results({ headSha: 'b'.repeat(40) }),
    results({ headSha: 'A'.repeat(40) }),
    results({
      results: [{ context: 'review/claude', state: 'success', description: '', details: [] }],
    }),
    results({
      results: [
        { context: 'plan-gate', state: 'success', description: '', details: [] },
        { context: 'plan-gate', state: 'success', description: '', details: [] },
      ],
    }),
    results({
      results: [{ context: 'plan-gate', state: 'pending' as never, description: '', details: [] }],
    }),
    results({
      results: [{ context: 'plan-gate', state: 'success', description: 3 as never, details: [] }],
    }),
    results({
      results: [{ context: 'plan-gate', state: 'success', description: '', details: [1] as never }],
    }),
    { version: 1, headSha: SHA },
  ];
  for (const raw of bad) {
    const v = validateResults(raw, o);
    assert.equal(v.ok, false, JSON.stringify(raw));
  }
});

test('toStatuses: 결과가 없으면 모든 context error, 빠진 context도 error', () => {
  const none = toStatuses(null, ['plan-gate', 'risk-gate'], '판정 결과 없음');
  assert.deepEqual(
    none.map((s) => [s.context, s.state]),
    [
      ['plan-gate', 'error'],
      ['risk-gate', 'error'],
    ],
  );
  assert.match(none[0].description, /판정 결과 없음/);
  const only = results();
  only.results = only.results.filter((x) => x.context === 'plan-gate');
  const part = toStatuses(only, ['plan-gate', 'risk-gate'], 'x');
  assert.deepEqual(
    part.map((s) => [s.context, s.state]),
    [
      ['plan-gate', 'success'],
      ['risk-gate', 'error'],
    ],
  );
});

test('toStatuses: description은 제어 문자를 공백으로, 140자로 자른다', () => {
  const long = '가'.repeat(200);
  const [s] = toStatuses(
    results({
      results: [
        { context: 'plan-gate', state: 'failure', description: `a\nb\u0007c${long}`, details: [] },
      ],
    }),
    GATE_CONTEXTS,
    'x',
  );
  assert.ok(s.description.length <= 140);
  assert.ok(s.description.startsWith('a b c'));
  assert.ok(!/[\u0000-\u001f\u007f]/.test(s.description));
});

// ---------- recordStatuses ----------

function poster(): { posted: StatusPayload[]; post: (p: StatusPayload) => Promise<void> } {
  const posted: StatusPayload[] = [];
  return { posted, post: async (p) => void posted.push(p) };
}

const REC = { headSha: SHA, repo: 'owner/repo', targetUrl: 'https://example.invalid/run/1' };

test('recordStatuses: 정상 결과를 그대로 기록한다', async () => {
  const p = poster();
  const r = await recordStatuses({ ...REC, raw: JSON.stringify(results()), post: p.post });
  assert.deepEqual(r, { ok: true, reason: null });
  assert.deepEqual(
    p.posted.map((s) => [s.context, s.state]),
    GATE_CONTEXTS.map((c) => [c, 'success']),
  );
});

test('recordStatuses: 결과가 없거나 깨졌으면 모든 context error + ok:false', async () => {
  for (const raw of [null, '', '{', JSON.stringify(results({ headSha: 'b'.repeat(40) }))]) {
    const p = poster();
    const r = await recordStatuses({ ...REC, raw, post: p.post });
    assert.equal(r.ok, false);
    assert.ok(r.reason);
    assert.deepEqual(
      p.posted.map((s) => [s.context, s.state]),
      GATE_CONTEXTS.map((c) => [c, 'error']),
    );
  }
});

test('recordStatuses: repo·sha 형식이 틀리면 아무것도 쓰지 않고 예외', async () => {
  for (const bad of [
    { repo: 'owner', headSha: SHA },
    { repo: 'owner/repo/x', headSha: SHA },
    { repo: 'owner/repo', headSha: 'abc' },
  ]) {
    const p = poster();
    await assert.rejects(
      recordStatuses({ ...REC, ...bad, raw: JSON.stringify(results()), post: p.post }),
    );
    assert.equal(p.posted.length, 0);
  }
});

// ---------- gates.yml 불변식 (10.4절) ----------

const WF = readFileSync(path.join(HARNESS_ROOT, '.github/workflows/gates.yml'), 'utf8');

/** 최상위 job 블록(2칸 들여쓰기 키) */
function jobs(text: string): Map<string, string> {
  const body = text.slice(text.indexOf('\njobs:') + 1);
  const out = new Map<string, string>();
  let cur: string | null = null;
  for (const line of body.split('\n').slice(1)) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m) {
      cur = m[1];
      out.set(cur, '');
    } else if (/^\S/.test(line)) break;
    else if (cur) out.set(cur, out.get(cur) + line + '\n');
  }
  return out;
}

/** `run: |` 블록과 한 줄 `run:`의 내용 */
function runBlocks(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = /^(\s*)(?:- )?run:\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    if (m[2] && m[2] !== '|' && m[2] !== '>') {
      out.push(m[2]);
      continue;
    }
    const indent = m[1].length;
    const block: string[] = [];
    for (i++; i < lines.length; i++) {
      const l = lines[i];
      if (l.trim() && l.length - l.trimStart().length <= indent) {
        i--;
        break;
      }
      block.push(l);
    }
    out.push(block.join('\n'));
  }
  return out;
}

test('gates.yml: 액션은 커밋 SHA로 고정, 최상위 권한 없음, 캐시 없음', () => {
  const uses = [...WF.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 4);
  for (const u of uses) assert.match(u, /@[0-9a-f]{40}$/, u);
  assert.match(WF, /^permissions: \{\}$/m);
  assert.doesNotMatch(WF, /cache/i);
  assert.match(WF, /pull_request_target:/);
});

test('gates.yml: recorder environment는 record job에만, 판정 job은 비밀이 없다', () => {
  const j = jobs(WF);
  assert.ok(j.has('evaluate') && j.has('record'), [...j.keys()].join(','));
  assert.doesNotMatch(j.get('evaluate')!, /environment:|secrets\.|vars\./);
  assert.match(j.get('record')!, /environment: recorder/);
  // 기록 job은 PR 트리를 받지 않는다(base의 scripts/만)
  assert.doesNotMatch(j.get('record')!, /path: pr\b|ref: \$\{\{ github\.event\.pull_request\.head/);
  for (const [name, body] of j) {
    if (name !== 'record') assert.doesNotMatch(body, /environment:/, name);
  }
});

test('gates.yml: run 블록에 PR 유래 표현식을 직접 넣지 않는다', () => {
  for (const b of runBlocks(WF)) {
    assert.doesNotMatch(b, /\$\{\{\s*(github\.event|github\.head_ref|needs\.|steps\.)/, b);
  }
});

test('review-trigger.yml: PR 쪽 정의로 도므로 비밀·environment·권한·체크아웃이 없다', () => {
  const t = readFileSync(path.join(HARNESS_ROOT, '.github/workflows/review-trigger.yml'), 'utf8');
  assert.match(t, /^permissions: \{\}$/m);
  assert.match(t, /pull_request_review:/);
  assert.doesNotMatch(t, /environment:|secrets\.|vars\.|^\s*(?:- )?uses:|: write/m);
  assert.match(WF, /workflows: \[review-trigger\]/);
});
