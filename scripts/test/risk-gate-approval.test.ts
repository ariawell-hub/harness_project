// 제작자 승인 결속(Issue #250): 승인 head(H0)를 check suite 시각으로 정하고, main 병합만 더한 갱신에 이어받는다.
// 리뷰가 보고하는 커밋(commit_id)은 GitHub이 새 head로 옮겨 보고하므로(PR #226) 판정에 쓰지 않는다.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { ownerApprovalCarry, patchId } from '../ci/binding.ts';
import { readApprovalInputs } from '../ci/gates.ts';
import { ownerApproval, type Review, type Suite } from '../gates/risk-gate.ts';
import { commitAll, gitInit, sh, tmp, write } from './helpers.ts';

const APP = 15368;
const BR = 'fix/20261126-demo-s0';
const sha = (c: string) => c.repeat(40);
const A = sha('a');
const B = sha('b');
const C = sha('c');

const suite = (createdAt: string, appId = APP, headBranch: string | null = BR): Suite => ({
  appId,
  headBranch,
  createdAt,
});
const approve = (at: string, commitId = A, state = 'APPROVED'): Review => ({
  user: 'maker',
  state,
  commitId,
  submittedAt: at,
});

/** 판정 입력. carry가 부른 H0를 calls에 담는다 */
function judge(o: {
  reviews: Review[];
  headSha: string;
  suites: Record<string, Suite[]>;
  forcePushedAt?: string[];
  carry?: string | null;
  owner?: string;
}) {
  const calls: string[] = [];
  const r = ownerApproval({
    reviews: o.reviews,
    owner: o.owner ?? 'maker',
    headSha: o.headSha,
    suites: o.suites,
    forcePushedAt: o.forcePushedAt ?? [],
    headBranch: BR,
    actionsAppId: APP,
    carry: (h0) => {
      calls.push(h0);
      return o.carry === undefined ? null : o.carry;
    },
  });
  return { r, calls };
}

// ---------- ownerApproval: 승인 head 정하기 ----------

test('ownerApproval: 리뷰 전에 suite가 생긴 가장 늦은 커밋이 지금 head면 승인(from head), carry를 부르지 않는다', () => {
  const { r, calls } = judge({
    reviews: [approve('2026-11-25T04:36:27Z')],
    headSha: B,
    suites: { [A]: [suite('2026-11-25T03:00:00Z')], [B]: [suite('2026-11-25T03:40:49Z')] },
  });
  assert.deepEqual(r, { approved: true, from: 'head' });
  assert.deepEqual(calls, []);
});

test('ownerApproval: H0가 지금 head가 아니면 carry(H0)가 null일 때만 이어받는다', () => {
  const suites = {
    [A]: [suite('2026-11-25T03:40:49Z')],
    [B]: [suite('2026-11-26T00:19:29Z')],
  };
  const ok = judge({ reviews: [approve('2026-11-25T04:36:27Z')], headSha: B, suites });
  assert.deepEqual(ok.r, { approved: true, from: A });
  assert.deepEqual(ok.calls, [A]);
  const no = judge({
    reviews: [approve('2026-11-25T04:36:27Z')],
    headSha: B,
    suites,
    carry: '승인 뒤 main 병합이 아닌 커밋이 있다',
  });
  assert.equal(no.r.approved, false);
  assert.match((no.r as { why: string }).why, /main 병합이 아닌 커밋/);
});

test('ownerApproval: 리뷰가 옮겨진 commitId(지금 head)를 보고해도 H0가 다르면 carry를 거친다', () => {
  const { r, calls } = judge({
    reviews: [approve('2026-11-25T04:36:27Z', B)],
    headSha: B,
    suites: { [A]: [suite('2026-11-25T03:40:49Z')], [B]: [suite('2026-11-25T05:00:00Z')] },
    carry: '패치가 다르다',
  });
  assert.equal(r.approved, false);
  assert.deepEqual(calls, [A]);
});

test('ownerApproval: PR #226의 실제 값에서 H0는 5027f12이고 main 병합 head에 이어받는다', () => {
  const h0 = '5027f12e9751d744928bc18e04b12d8ebc1f4a90';
  const m1 = 'c5d5338f30726a3333d568b0eba056a243e140e8';
  const m2 = 'a1aae51fd63cf10fb9a314198b71b2d585767532';
  const { r, calls } = judge({
    // GitHub은 이 리뷰의 커밋을 a1aae51로 보고했다
    reviews: [approve('2026-11-25T04:36:27Z', m2)],
    headSha: m2,
    suites: {
      // 승인 뒤 재판정(04:36:30)으로 같은 커밋에 suite가 더 생겼다
      [h0]: [
        suite('2026-11-25T03:40:49Z'),
        suite('2026-11-25T03:40:51Z'),
        suite('2026-11-25T04:18:30Z'),
        suite('2026-11-25T04:36:30Z'),
      ],
      [m1]: [suite('2026-11-26T00:19:29Z')],
      [m2]: [suite('2026-11-26T03:09:08Z')],
    },
  });
  assert.deepEqual(r, { approved: true, from: h0 });
  assert.deepEqual(calls, [h0]);
});

test('ownerApproval: 리뷰와 같은 초에 생긴 suite는 H0 후보가 아니다', () => {
  const { r, calls } = judge({
    reviews: [approve('2026-11-25T12:00:05Z')],
    headSha: B,
    suites: { [A]: [suite('2026-11-25T11:00:00Z')], [B]: [suite('2026-11-25T12:00:05Z')] },
    carry: '일반 커밋',
  });
  assert.equal(r.approved, false);
  assert.deepEqual(calls, [A], '같은 초의 B가 아니라 A를 H0로 본다');
});

test('ownerApproval: H0의 첫 suite가 리뷰 제출 60초 안이면 승인 head가 모호하다', () => {
  const at = (first: string) =>
    judge({
      reviews: [approve('2026-11-25T12:01:00Z')],
      headSha: A,
      suites: { [A]: [suite(first)] },
    }).r;
  for (const first of ['2026-11-25T12:00:59Z', '2026-11-25T12:00:30Z', '2026-11-25T12:00:00Z']) {
    const r = at(first);
    assert.equal(r.approved, false, first);
    assert.match((r as { why: string }).why, /60초/);
  }
  assert.deepEqual(at('2026-11-25T11:59:59Z'), { approved: true, from: 'head' });
});

test('ownerApproval: 다른 브랜치·다른 App의 suite는 무시하고, 한 커밋의 suite는 가장 이른 것을 쓴다', () => {
  const { r, calls } = judge({
    reviews: [approve('2026-11-25T12:00:00Z')],
    headSha: C,
    suites: {
      [A]: [suite('2026-11-25T10:00:00Z')],
      // B는 다른 브랜치·다른 App의 suite만 있다(후보 아님)
      [B]: [suite('2026-11-25T11:00:00Z', APP, 'main'), suite('2026-11-25T11:00:00Z', 1)],
      // C는 승인 전에 처음 나왔고 승인 뒤 suite가 더 있다
      [C]: [suite('2026-11-25T13:00:00Z'), suite('2026-11-25T10:30:00Z')],
    },
  });
  assert.deepEqual(r, { approved: true, from: 'head' });
  assert.deepEqual(calls, []);
});

test('ownerApproval: 마지막 판정 리뷰가 승인이 아니거나, suite가 없거나, 시각이 겹치거나 깨지면 승인 아님', () => {
  const suites = { [A]: [suite('2026-11-25T10:00:00Z')] };
  const cases: [string, Parameters<typeof judge>[0]][] = [
    [
      '변경 요청',
      {
        reviews: [
          approve('2026-11-25T12:00:00Z'),
          approve('2026-11-25T12:30:00Z', A, 'CHANGES_REQUESTED'),
        ],
        headSha: A,
        suites,
      },
    ],
    [
      '철회',
      {
        reviews: [approve('2026-11-25T12:00:00Z'), approve('2026-11-25T12:30:00Z', A, 'DISMISSED')],
        headSha: A,
        suites,
      },
    ],
    ['리뷰 없음', { reviews: [], headSha: A, suites }],
    [
      '다른 계정',
      { reviews: [{ ...approve('2026-11-25T12:00:00Z'), user: 'bot' }], headSha: A, suites },
    ],
    [
      '제작자 설정 없음',
      { reviews: [approve('2026-11-25T12:00:00Z')], headSha: A, suites, owner: '' },
    ],
    ['suite 없음', { reviews: [approve('2026-11-25T12:00:00Z')], headSha: A, suites: {} }],
    [
      '리뷰보다 늦은 suite만',
      {
        reviews: [approve('2026-11-25T12:00:00Z')],
        headSha: A,
        suites: { [A]: [suite('2026-11-25T13:00:00Z')] },
      },
    ],
    [
      '첫 suite 시각이 같은 커밋 둘',
      {
        reviews: [approve('2026-11-25T12:00:00Z')],
        headSha: A,
        suites: { [A]: [suite('2026-11-25T10:00:00Z')], [B]: [suite('2026-11-25T10:00:00Z')] },
      },
    ],
    [
      'suite 시각이 깨짐',
      { reviews: [approve('2026-11-25T12:00:00Z')], headSha: A, suites: { [A]: [suite('어제')] } },
    ],
    ['제출 시각이 깨짐', { reviews: [approve('')], headSha: A, suites }],
  ];
  for (const [name, input] of cases) {
    const { r, calls } = judge(input);
    assert.equal(r.approved, false, name);
    assert.ok((r as { why: string }).why.length > 0, name);
    assert.deepEqual(calls, [], name);
  }
  // 승인 뒤의 COMMENTED는 판정 리뷰가 아니다
  const commented = judge({
    reviews: [approve('2026-11-25T12:00:00Z'), approve('2026-11-25T12:30:00Z', A, 'COMMENTED')],
    headSha: A,
    suites,
  });
  assert.deepEqual(commented.r, { approved: true, from: 'head' });
  // 계정 이름의 대소문자는 가리지 않는다
  assert.deepEqual(
    judge({ reviews: [{ ...approve('2026-11-25T12:00:00Z'), user: 'Maker' }], headSha: A, suites })
      .r,
    { approved: true, from: 'head' },
  );
});

test('ownerApproval: H0의 첫 suite 이후(같은 초 포함) 강제 push가 있으면 승인 아님, 그 전의 강제 push는 상관없다', () => {
  const base = {
    reviews: [approve('2026-11-25T12:00:00Z')],
    headSha: A,
    suites: { [A]: [suite('2026-11-25T10:00:00Z')] },
  };
  assert.deepEqual(judge({ ...base, forcePushedAt: ['2026-11-25T09:59:59Z'] }).r, {
    approved: true,
    from: 'head',
  });
  for (const at of ['2026-11-25T10:00:00Z', '2026-11-25T11:00:00Z', '2026-11-25T12:30:00Z']) {
    const { r } = judge({ ...base, forcePushedAt: ['2026-11-25T09:00:00Z', at] });
    assert.equal(r.approved, false, at);
    assert.match((r as { why: string }).why, /강제 push/, at);
  }
  assert.equal(judge({ ...base, forcePushedAt: ['깨진 시각'] }).r.approved, false);
});

test('ownerApproval: 승인한 A가 강제 push로 사라지고 예전에 suite가 있던 B로 head가 돌아오면 승인 아님(계획 검증 F9)', () => {
  // B 10:00 → (강제 push) A 11:00 → 제작자가 A를 승인 12:00 → (강제 push) B 12:30. 지금 PR 커밋 목록에는 A가 없다
  const { r, calls } = judge({
    reviews: [approve('2026-11-25T12:00:00Z', A)],
    headSha: B,
    suites: { [B]: [suite('2026-11-25T10:00:00Z')] },
    forcePushedAt: ['2026-11-25T11:00:00Z', '2026-11-25T12:30:00Z'],
  });
  assert.equal(r.approved, false);
  assert.deepEqual(calls, []);
  // 승인 뒤의 강제 push만 있어도 같다
  const after = judge({
    reviews: [approve('2026-11-25T12:00:00Z', A)],
    headSha: B,
    suites: { [B]: [suite('2026-11-25T10:00:00Z')] },
    forcePushedAt: ['2026-11-25T12:30:00Z'],
  });
  assert.equal(after.r.approved, false);
});

test('ownerApproval: 새 head의 suite가 리뷰보다 늦게 생기면(지연) H0는 앞 커밋이고 carry가 판정한다', () => {
  // B는 11:59:50에 push됐지만 suite는 리뷰(12:00:00) 뒤 12:00:10에 생겼다
  const { r, calls } = judge({
    reviews: [approve('2026-11-25T12:00:00Z')],
    headSha: B,
    suites: { [A]: [suite('2026-11-25T10:00:00Z')], [B]: [suite('2026-11-25T12:00:10Z')] },
    carry: '승인 뒤 main 병합이 아닌 커밋이 있다',
  });
  assert.equal(r.approved, false);
  assert.deepEqual(calls, [A]);
});

// ---------- ownerApprovalCarry: 실제 git 이력 ----------

/** main에 base, PR 브랜치에 PR 파일 변경(H0). 돌려주는 값은 리포와 H0, PR 파일 */
function prRepo() {
  const root = path.join(tmp(), 'r');
  gitInit(root);
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  write(root, 'p.txt', lines.join('\n') + '\n');
  write(root, 'm.txt', 'm\n');
  commitAll(root, 'base');
  sh('git', ['checkout', '-q', '-b', 'pr'], root);
  write(root, 'p.txt', ['changed 1', ...lines.slice(1)].join('\n') + '\n');
  write(root, 'q.txt', 'q\n');
  const h0 = commitAll(root, 'pr change');
  return { root, h0, lines, prFiles: ['p.txt', 'q.txt'] };
}

/** main에 커밋 하나를 더한다(그 뒤 PR 브랜치로 돌아온다) */
function onMain(root: string, files: Record<string, string>, msg = 'main change'): void {
  sh('git', ['checkout', '-q', 'main'], root);
  for (const [f, c] of Object.entries(files)) write(root, f, c);
  commitAll(root, msg);
  sh('git', ['checkout', '-q', 'pr'], root);
}

const mergeMain = (root: string) => sh('git', ['merge', '-q', '--no-edit', 'main'], root);
const baseOf = (root: string) => sh('git', ['merge-base', 'HEAD', 'main'], root);
const carry = (r: ReturnType<typeof prRepo>) =>
  ownerApprovalCarry(r.root, baseOf(r.root), r.h0, r.prFiles);

test('ownerApprovalCarry: PR과 겹치지 않는 main 변경을 병합만 했으면 이어받는다(병합 둘도)', () => {
  const r = prRepo();
  onMain(r.root, { 'm.txt': 'm2\n' });
  mergeMain(r.root);
  assert.equal(carry(r), null);
  onMain(r.root, { 'n.txt': 'n\n' });
  mergeMain(r.root);
  assert.equal(carry(r), null);
});

test('ownerApprovalCarry: 승인 뒤 일반 커밋(빈 커밋, 바꿨다 되돌린 커밋)이 있으면 이어받지 않는다', () => {
  const empty = prRepo();
  sh('git', ['commit', '-q', '--allow-empty', '-m', 'empty'], empty.root);
  assert.match(carry(empty) ?? '', /main 병합이 아닌 커밋/);

  const undo = prRepo();
  write(undo.root, 'p.txt', 'x\n');
  commitAll(undo.root, 'change');
  sh('git', ['revert', '--no-edit', 'HEAD'], undo.root);
  assert.match(carry(undo) ?? '', /main 병합이 아닌 커밋/);

  // 일반 커밋 뒤에 main 병합을 더해도 같다
  const mixed = prRepo();
  sh('git', ['commit', '-q', '--allow-empty', '-m', 'empty'], mixed.root);
  onMain(mixed.root, { 'm.txt': 'm2\n' });
  mergeMain(mixed.root);
  assert.match(carry(mixed) ?? '', /main 병합이 아닌 커밋/);
});

test('ownerApprovalCarry: main이 아닌 브랜치를 병합했으면 이어받지 않는다', () => {
  const r = prRepo();
  sh('git', ['checkout', '-q', '-b', 'side'], r.root);
  write(r.root, 's.txt', 's\n');
  commitAll(r.root, 'side');
  sh('git', ['checkout', '-q', 'pr'], r.root);
  sh('git', ['merge', '-q', '--no-ff', '--no-edit', 'side'], r.root);
  assert.match(carry(r) ?? '', /main이 아닌 커밋/);
});

test('ownerApprovalCarry: main이 PR 파일을 바꾼 뒤 병합했으면 이어받지 않는다', () => {
  const r = prRepo();
  // PR이 1행을, main이 30행을 바꿔 충돌 없이 병합된다
  onMain(r.root, { 'p.txt': [...r.lines.slice(0, 29), 'main 30'].join('\n') + '\n' });
  mergeMain(r.root);
  assert.notEqual(carry(r), null);
});

test('ownerApprovalCarry: 병합 커밋에서 PR 파일을 더 고쳤으면(evil merge) 이어받지 않는다', () => {
  const r = prRepo();
  onMain(r.root, { 'm.txt': 'm2\n' });
  sh('git', ['merge', '-q', '--no-commit', 'main'], r.root);
  write(r.root, 'q.txt', 'q evil\n');
  sh('git', ['add', '-A'], r.root);
  sh('git', ['commit', '-q', '--no-edit'], r.root);
  assert.equal(
    sh('git', ['rev-list', '--parents', '-n', '1', 'HEAD'], r.root).split(' ').length,
    3,
  );
  assert.match(carry(r) ?? '', /patch-id|PR 파일/);
});

test('ownerApprovalCarry: H0가 지금 head의 조상이 아니거나 SHA가 아니면 이어받지 않는다', () => {
  const r = prRepo();
  sh('git', ['checkout', '-q', '-b', 'other', 'main'], r.root);
  write(r.root, 'o.txt', 'o\n');
  const other = commitAll(r.root, 'other');
  sh('git', ['checkout', '-q', 'pr'], r.root);
  assert.match(ownerApprovalCarry(r.root, baseOf(r.root), other, r.prFiles) ?? '', /조상이 아니다/);
  assert.notEqual(ownerApprovalCarry(r.root, baseOf(r.root), 'HEAD', r.prFiles), null);
  assert.notEqual(ownerApprovalCarry(r.root, baseOf(r.root), sha('f'), r.prFiles), null);
});

test('patchId: 셋째 인자로 비교 끝을 정하고, 주지 않으면 HEAD다', () => {
  const r = prRepo();
  const base = baseOf(r.root);
  const head = patchId(r.root, base);
  assert.equal(patchId(r.root, base, 'HEAD'), head);
  assert.equal(patchId(r.root, base, r.h0), head);
  onMain(r.root, { 'm.txt': 'm2\n' });
  mergeMain(r.root);
  // main 병합 뒤에도 각자의 merge-base에서 잰 patch-id는 같다
  assert.equal(patchId(r.root, baseOf(r.root), r.h0), patchId(r.root, baseOf(r.root)));
});

// ---------- readApprovalInputs: 읽기 경로 ----------

const REPO = 'o/r';
const commitsPath = (page: number) => `repos/${REPO}/pulls/7/commits?per_page=100&page=${page}`;
const suitesPath = (s: string, page: number) =>
  `repos/${REPO}/commits/${s}/check-suites?per_page=100&page=${page}`;
const rawSuite = (at: string, appId = APP) => ({
  app: { id: appId },
  head_branch: BR,
  created_at: at,
});
const hexOf = (i: number) => i.toString(16).padStart(40, '0');

/** 경로 → 응답(함수면 불러서, Error면 던진다). 없는 경로는 던진다. 부른 경로를 담는다 */
function fakeApi(table: Record<string, unknown>) {
  const asked: string[] = [];
  const api = async (p: string) => {
    asked.push(p);
    if (!(p in table)) throw new Error(`없는 경로: ${p}`);
    const v = table[p];
    if (v instanceof Error) throw v;
    return v;
  };
  return { api, asked };
}

/** GraphQL 응답 쪽들. after가 null이면 첫 쪽 */
function fakeGraphql(pages: unknown[]) {
  const asked: (string | null)[] = [];
  const graphql = async (_q: string, v: Record<string, unknown>) => {
    asked.push((v.after as string | null) ?? null);
    const i = asked.length - 1;
    const p = pages[i];
    if (p instanceof Error) throw p;
    if (p === undefined) throw new Error('쪽 없음');
    return p;
  };
  return { graphql, asked };
}

const fpPage = (times: string[], next: string | null, extra: Record<string, unknown> = {}) => ({
  repository: {
    pullRequest: {
      timelineItems: {
        totalCount: 39,
        pageInfo: { hasNextPage: next !== null, endCursor: next },
        nodes: times.map((createdAt) => ({ createdAt })),
        ...extra,
      },
    },
  },
});

/** 커밋 101개(두 쪽), 첫 커밋의 suite 102개(두 쪽, 승인 전·후 포함), 강제 push 두 쪽 */
function bigTable() {
  const shas = Array.from({ length: 101 }, (_, i) => hexOf(i + 1));
  const table: Record<string, unknown> = {
    [commitsPath(1)]: shas.slice(0, 100).map((s) => ({ sha: s })),
    [commitsPath(2)]: shas.slice(100).map((s) => ({ sha: s })),
  };
  for (const s of shas) table[suitesPath(s, 1)] = { total_count: 0, check_suites: [] };
  const many = Array.from({ length: 100 }, (_, i) =>
    rawSuite(
      `2026-11-25T10:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
    ),
  );
  table[suitesPath(shas[0], 1)] = { total_count: 102, check_suites: many };
  table[suitesPath(shas[0], 2)] = {
    total_count: 102,
    check_suites: [rawSuite('2026-11-25T03:40:49Z'), rawSuite('2026-11-25T04:36:30Z')],
  };
  return { shas, table };
}

test('readApprovalInputs: PR 커밋·check suite·강제 push 이벤트를 모든 쪽에서 합친다', async () => {
  const { shas, table } = bigTable();
  const { api, asked } = fakeApi(table);
  const { graphql, asked: gq } = fakeGraphql([
    fpPage(['2026-11-25T01:00:00Z'], 'c1'),
    fpPage(['2026-11-25T02:00:00Z'], null),
  ]);
  const r = await readApprovalInputs({ api, graphql, repo: REPO, pr: 7 });
  assert.ok(r);
  assert.deepEqual(Object.keys(r.suites).sort(), [...shas].sort());
  // 한 커밋의 suite 여럿(승인 전·후)을 거르지 않고 모두 넘긴다
  assert.equal(r.suites[shas[0]].length, 102);
  assert.ok(r.suites[shas[0]].some((s) => s.createdAt === '2026-11-25T03:40:49Z'));
  assert.ok(r.suites[shas[0]].some((s) => s.createdAt === '2026-11-25T04:36:30Z'));
  assert.deepEqual(r.suites[shas[0]][0], suite('2026-11-25T10:00:00Z'));
  assert.deepEqual(r.forcePushedAt, ['2026-11-25T01:00:00Z', '2026-11-25T02:00:00Z']);
  assert.deepEqual(gq, [null, 'c1']);
  assert.ok(asked.includes(suitesPath(shas[0], 2)));
});

test('readApprovalInputs: 둘째 쪽 이후 오류나 틀린 응답 꼴은 빈 목록이 아니라 null이다', async () => {
  const fp = () => fakeGraphql([fpPage([], null)]).graphql;
  const run = (table: Record<string, unknown>, graphql = fp()) =>
    readApprovalInputs({ api: fakeApi(table).api, graphql, repo: REPO, pr: 7 });
  const { shas, table } = bigTable();
  assert.equal(
    await run({ ...table, [commitsPath(2)]: new Error('HTTP 502') }),
    null,
    '커밋 2쪽 오류',
  );
  assert.equal(
    await run({ ...table, [suitesPath(shas[0], 2)]: new Error('HTTP 502') }),
    null,
    'suite 2쪽 오류',
  );
  assert.equal(
    await run({ ...table, [commitsPath(1)]: { message: 'x' } }),
    null,
    '커밋 목록이 배열이 아님',
  );
  assert.equal(await run({ ...table, [commitsPath(2)]: [{ sha: 'zz' }] }), null, 'SHA가 아님');
  assert.equal(
    await run({ ...table, [suitesPath(shas[5], 1)]: { total_count: 0 } }),
    null,
    'check_suites 없음',
  );
  assert.equal(
    await run({
      ...table,
      [suitesPath(shas[5], 1)]: {
        total_count: 1,
        check_suites: [{ app: { id: APP }, head_branch: BR }],
      },
    }),
    null,
    'created_at 없음',
  );
  assert.equal(
    await run(table, fakeGraphql([fpPage([], 'c1'), new Error('HTTP 502')]).graphql),
    null,
    'GraphQL 2쪽 오류',
  );
  assert.equal(
    await run(table, fakeGraphql([fpPage([], 'c1', { nodes: undefined })]).graphql),
    null,
    'nodes 없음',
  );
  assert.equal(await run(table, fakeGraphql([fpPage([], '')]).graphql), null, 'endCursor 없음');
  assert.equal(
    await run(
      table,
      fakeGraphql([
        {
          repository: {
            pullRequest: { timelineItems: { pageInfo: { hasNextPage: false }, nodes: [{}] } },
          },
        },
      ]).graphql,
    ),
    null,
    '강제 push 시각 없음',
  );
  assert.equal(
    await run(table, fakeGraphql([{ repository: { pullRequest: null } }]).graphql),
    null,
    'PR 없음',
  );
  assert.equal(
    await readApprovalInputs({ api: fakeApi(table).api, graphql: fp(), repo: 'not-a-repo', pr: 7 }),
    null,
  );
});

test('readApprovalInputs: PR 커밋이 250개면 null(GitHub이 더 주지 않는다), totalCount는 세지 않는다', async () => {
  const shas = Array.from({ length: 250 }, (_, i) => hexOf(i + 1));
  const table: Record<string, unknown> = {
    [commitsPath(1)]: shas.slice(0, 100).map((s) => ({ sha: s })),
    [commitsPath(2)]: shas.slice(100, 200).map((s) => ({ sha: s })),
    [commitsPath(3)]: shas.slice(200).map((s) => ({ sha: s })),
  };
  const { api } = fakeApi(table);
  assert.equal(
    await readApprovalInputs({
      api,
      graphql: fakeGraphql([fpPage([], null)]).graphql,
      repo: REPO,
      pr: 7,
    }),
    null,
  );
  // 커밋 하나, 강제 push 없음(totalCount 39는 거르기 전 수)
  const one = fakeApi({
    [commitsPath(1)]: [{ sha: A }],
    [suitesPath(A, 1)]: { total_count: 1, check_suites: [rawSuite('2026-11-25T03:40:49Z')] },
  });
  const r = await readApprovalInputs({
    api: one.api,
    graphql: fakeGraphql([fpPage([], null)]).graphql,
    repo: REPO,
    pr: 7,
  });
  assert.deepEqual(r, { suites: { [A]: [suite('2026-11-25T03:40:49Z')] }, forcePushedAt: [] });
});
