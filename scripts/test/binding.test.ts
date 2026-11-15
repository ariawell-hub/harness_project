// 승인 결속(scripts/ci/binding.ts, 10.3절): patch-id와 승인 이어받기.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  carryOver,
  changedOnBaseSince,
  fetchCandidates,
  samePrContent,
  patchId,
  patchOf,
  withPatch,
  type Candidate,
} from '../ci/binding.ts';
import { oneLine, recordReview } from '../ci/record.ts';
import type { StatusPayload } from '../ci/results.ts';
import { commitAll, gitInit, sh, tmp, write } from './helpers.ts';

const BOT = 'harness-recorder[bot]';
const CTX = 'review/claude';

/** main에 a.txt·b.txt, PR 브랜치가 a.txt를 바꾼 리포 */
function repo(): { root: string; oldHead: string } {
  const root = path.join(tmp('binding-'), 'pr');
  gitInit(root);
  write(root, 'a.txt', 'a1\na2\na3\n');
  write(root, 'b.txt', 'b1\n');
  commitAll(root, 'init');
  sh('git', ['checkout', '-q', '-b', 'feat/x'], root);
  write(root, 'a.txt', 'a1\na2 changed\na3\n');
  const oldHead = commitAll(root, 'pr change');
  return { root, oldHead };
}
function mainCommit(root: string, file: string, content: string): void {
  sh('git', ['checkout', '-q', 'main'], root);
  write(root, file, content);
  commitAll(root, `main ${file}`);
  sh('git', ['checkout', '-q', 'feat/x'], root);
}
const mergeBase = (root: string) => sh('git', ['merge-base', 'main', 'HEAD'], root);

test('patchId: main 병합으로 갱신해도 같다. 변경이 없으면 빈 문자열', () => {
  const { root } = repo();
  const before = patchId(root, mergeBase(root));
  assert.match(before, /^[0-9a-f]{40}$/);
  mainCommit(root, 'b.txt', 'b1\nb2\n');
  sh('git', ['merge', '-q', '--no-edit', 'main'], root);
  assert.equal(patchId(root, mergeBase(root)), before);
  assert.equal(patchId(root, 'HEAD'), '');
});

test('patchId: 충돌을 해결하며 PR 변경이 바뀌면 달라진다', () => {
  const { root } = repo();
  const before = patchId(root, mergeBase(root));
  mainCommit(root, 'a.txt', 'a1\na2 main\na3\n');
  assert.throws(() => sh('git', ['merge', '-q', '--no-edit', 'main'], root));
  write(root, 'a.txt', 'a1\na2 resolved\na3\n');
  commitAll(root, 'resolve');
  assert.notEqual(patchId(root, mergeBase(root)), before);
});

test('withPatch·patchOf: description 끝에 patch 전체(40자)를 붙이고 140자를 넘기지 않는다', () => {
  const id = 'ab12'.repeat(10);
  const d = withPatch('승인 (지적 없음)', id);
  assert.equal(d, `승인 (지적 없음) patch:${id}`);
  assert.equal(patchOf(d), id);
  // 잘린 id는 붙이지도 읽지도 않는다(앞부분만 같은 다른 diff를 만들 수 있다)
  assert.equal(withPatch('승인', id.slice(0, 16)), '승인');
  assert.equal(patchOf(`승인 patch:${id.slice(0, 16)}`), null);
  const long = withPatch('가'.repeat(200), id);
  assert.ok(long.length <= 140);
  assert.equal(patchOf(long), id);
  assert.equal(patchOf('승인 (지적 없음)'), null);
  assert.equal(patchOf(`patch:${id} 뒤에 글`), null);
  assert.equal(patchOf(`x patch:ZZ${id.slice(2)}`), null);
  assert.equal(withPatch('승인', ''), '승인');
});

test('changedOnBaseSince: 옛 head 이후 main에서 바뀐 파일. 옛 head가 조상이 아니면 null', () => {
  const { root, oldHead } = repo();
  mainCommit(root, 'b.txt', 'b1\nb2\n');
  sh('git', ['merge', '-q', '--no-edit', 'main'], root);
  assert.deepEqual(changedOnBaseSince(root, 'main', oldHead), ['b.txt']);
  assert.deepEqual(changedOnBaseSince(root, 'main', sh('git', ['rev-parse', 'HEAD'], root)), []);
  // 다른 계보(강제 push 흉내): main에만 있는 커밋은 PR head의 조상이 아니다
  mainCommit(root, 'c.txt', 'c\n');
  assert.equal(changedOnBaseSince(root, 'main', sh('git', ['rev-parse', 'main'], root)), null);
  assert.equal(changedOnBaseSince(root, 'main', 'f'.repeat(40)), null);
});

const PATCH = 'c0ffee00'.repeat(5);
const ok = (over: Partial<Candidate['statuses'][number]> = {}) => ({
  context: CTX,
  state: 'success',
  description: withPatch('승인 (지적 없음)', PATCH),
  creator: BOT,
  ...over,
});
function carry(over: Partial<Parameters<typeof carryOver>[0]> = {}) {
  return carryOver({
    patch: PATCH,
    risk: 'normal',
    prFiles: ['a.txt'],
    candidates: [{ sha: '1'.repeat(40), statuses: [ok()] }],
    changedOnBaseSince: () => ['b.txt'],
    samePrContent: () => true,
    recorderBot: BOT,
    context: CTX,
    ...over,
  });
}

test('carryOver: patch가 같고 위험도 보통 이하, main 변경과 겹치지 않으면 이어받는다', () => {
  assert.deepEqual(carry(), { from: '1'.repeat(40) });
  assert.deepEqual(carry({ risk: 'low' }), { from: '1'.repeat(40) });
  // 이어받은 상태에서 다시 이어받을 수 있다
  const chained = carry({
    candidates: [
      {
        sha: '2'.repeat(40),
        statuses: [ok({ description: withPatch('이어받음 111111111111', PATCH) })],
      },
    ],
  });
  assert.deepEqual(chained, { from: '2'.repeat(40) });
});

test('carryOver: 위험도 높음, patch 없음·다름, 겹침, 조회 실패는 이어받지 않는다', () => {
  const no = (r: ReturnType<typeof carry>) => ('no' in r ? r.no : '');
  assert.match(no(carry({ risk: 'high' })), /높음/);
  assert.match(no(carry({ patch: '' })), /patch/);
  assert.match(no(carry({ patch: 'deadbeef'.repeat(5) })), /patch/);
  // 앞 16자만 같은 patch는 다른 변경이다
  assert.match(no(carry({ patch: PATCH.slice(0, 16) + 'deadbeef'.repeat(3) })), /patch/);
  assert.match(no(carry({ changedOnBaseSince: () => ['x.txt', 'a.txt'] })), /겹친다/);
  assert.match(no(carry({ changedOnBaseSince: () => null })), /조회|조상/);
  // patch-id는 공백을 무시한다. PR 파일이 바이트 단위로 같지 않으면 이어받지 않는다
  assert.match(no(carry({ samePrContent: () => false })), /내용이 다르다/);
  assert.match(no(carry({ candidates: [] })), /없다/);
  assert.match(no(carry({ recorderBot: '' })), /recorderBot/);
});

test('carryOver: 검증 App 봇이 쓴 상태만, 그 context의 마지막 상태만 본다', () => {
  const no = (r: ReturnType<typeof carry>) => ('no' in r ? r.no : '');
  // 봇 PAT이 쓴 같은 이름의 상태는 근거가 아니다
  assert.ok(
    no(
      carry({ candidates: [{ sha: '1'.repeat(40), statuses: [ok({ creator: 'harness-bot' })] }] }),
    ),
  );
  // 마지막(목록의 첫 항목) 상태가 failure면 그 앞의 success는 쓰지 않는다
  assert.match(
    no(
      carry({ candidates: [{ sha: '1'.repeat(40), statuses: [ok({ state: 'failure' }), ok()] }] }),
    ),
    /success가 아니다/,
  );
  // 다른 context의 success는 쓰지 않는다
  assert.ok(
    no(
      carry({ candidates: [{ sha: '1'.repeat(40), statuses: [ok({ context: 'review/codex' })] }] }),
    ),
  );
  // 가장 최근에 판정된 head만 본다: 최근 head가 실패면 더 옛 head의 승인을 쓰지 않는다
  assert.ok(
    no(
      carry({
        candidates: [
          { sha: '3'.repeat(40), statuses: [ok({ state: 'failure' })] },
          { sha: '1'.repeat(40), statuses: [ok()] },
        ],
      }),
    ),
  );
  // 판정 기록이 없는 head(중간 커밋)는 건너뛴다
  assert.deepEqual(
    carry({
      candidates: [
        { sha: '3'.repeat(40), statuses: [ok({ creator: 'someone' })] },
        { sha: '1'.repeat(40), statuses: [ok()] },
      ],
    }),
    { from: '1'.repeat(40) },
  );
});

// ---------- 기록 ----------

const SHA = 'a'.repeat(40);
function rec(over: Partial<Parameters<typeof recordReview>[0]>): Promise<StatusPayload> {
  return recordReview({
    context: CTX,
    needed: true,
    raw: JSON.stringify({ verdict: 'approve', risk: 'low', summary: 'ok', findings: [] }),
    secrets: [],
    headSha: SHA,
    repo: 'owner/repo',
    post: async () => {},
    ...over,
  });
}

test('recordReview: 승인에는 patch를 붙이고, 실패에는 붙이지 않는다', async () => {
  const a = await rec({ patch: PATCH });
  assert.equal(a.state, 'success');
  assert.equal(patchOf(a.description), PATCH);
  const f = await rec({
    patch: PATCH,
    raw: JSON.stringify({ verdict: 'request_changes', risk: 'low', summary: 'x', findings: [] }),
  });
  assert.equal(f.state, 'failure');
  assert.equal(patchOf(f.description), null);
  // patch 형식이 틀리면 붙이지 않는다(이어받을 수 없을 뿐 판정은 유효)
  const bad = await rec({ patch: 'not-hex' });
  assert.equal(bad.state, 'success');
  assert.equal(patchOf(bad.description), null);
});

test('recordReview: 이어받기는 판정 없이 success, 원래 SHA와 patch를 적는다', async () => {
  const c = await rec({ raw: null, carriedFrom: '1'.repeat(40), patch: PATCH });
  assert.equal(c.state, 'success');
  assert.equal(c.description, `이어받음 111111111111 patch:${PATCH}`);
  // 원래 SHA나 patch가 없거나 틀리면 error
  assert.equal((await rec({ raw: null, carriedFrom: 'zzz', patch: PATCH })).state, 'error');
  assert.equal((await rec({ raw: null, carriedFrom: '1'.repeat(40) })).state, 'error');
  // 필요 없는 검증자는 이어받기보다 "해당 없음"이 먼저다
  const n = await rec({ needed: false, raw: null, carriedFrom: '1'.repeat(40), patch: PATCH });
  assert.match(n.description, /해당 없음/);
});

test('recordReview: 검사를 통과한 판정의 지적을 onVerdict로 넘긴다(기록 job 로그용)', async () => {
  const seen: unknown[] = [];
  const raw = JSON.stringify({
    verdict: 'request_changes',
    risk: 'normal',
    summary: '요약',
    findings: [
      {
        severity: 'P1',
        file: 'a.ts',
        line: 3,
        title: '제목',
        evidence: '근거',
        suggestion: '제안',
      },
    ],
  });
  await rec({ raw, onVerdict: (v) => seen.push(v) });
  assert.equal(seen.length, 1);
  // 형식 오류·이어받기·해당 없음에서는 부르지 않는다
  await rec({ raw: '{"verdict":"x"}', onVerdict: (v) => seen.push(v) });
  await rec({
    raw: null,
    carriedFrom: '1'.repeat(40),
    patch: PATCH,
    onVerdict: (v) => seen.push(v),
  });
  assert.equal(seen.length, 1);
});

test('samePrContent: main 병합 갱신은 같고, 공백만 바꾼 커밋은 patch-id가 같아도 다르다', () => {
  const { root, oldHead } = repo();
  const before = patchId(root, mergeBase(root));
  mainCommit(root, 'b.txt', 'b1\nb2\n');
  sh('git', ['merge', '-q', '--no-edit', 'main'], root);
  assert.equal(samePrContent(root, oldHead, ['a.txt']), true);
  // 공백만 바꾼 후속 커밋: patch-id는 그대로다
  write(root, 'a.txt', 'a1\na2    changed\na3\n');
  commitAll(root, 'whitespace only');
  assert.equal(patchId(root, mergeBase(root)), before);
  assert.equal(samePrContent(root, oldHead, ['a.txt']), false);
  assert.equal(samePrContent(root, 'f'.repeat(40), ['a.txt']), false);
  assert.equal(samePrContent(root, oldHead, []), false);
});

test('patchId: 바이너리 파일의 내용이 바뀌면 달라진다', () => {
  const { root } = repo();
  write(root, 'bin.dat', 'x\u0000y1');
  commitAll(root, 'bin');
  const one = patchId(root, mergeBase(root));
  write(root, 'bin.dat', 'x\u0000y2');
  commitAll(root, 'bin2');
  assert.notEqual(patchId(root, mergeBase(root)), one);
});

test('fetchCandidates: 최신이 먼저, 지금 head 제외, 판정된 head를 찾으면 멈춘다', async () => {
  const sha = (c: string) => c.repeat(40);
  const calls: string[] = [];
  const statuses: Record<string, unknown[]> = {
    [sha('3')]: [{ context: 'check', state: 'success', description: '', creator: { login: 'x' } }],
    [sha('2')]: [
      { context: CTX, state: 'success', description: 'd', creator: { login: BOT } },
      { context: CTX, state: 'success', description: 'forged', creator: { login: 'harness-bot' } },
    ],
    [sha('1')]: [{ context: CTX, state: 'success', description: 'old', creator: { login: BOT } }],
  };
  const api = async (p: string) => {
    calls.push(p);
    if (p.includes('/pulls/7/commits')) return ['1', '2', '3', '4'].map((c) => ({ sha: sha(c) }));
    const m = /commits\/([0-9a-f]{40})\/statuses/.exec(p);
    return m ? (statuses[m[1]] ?? []) : null;
  };
  const o = { api, repo: 'o/r', number: 7, headSha: sha('4'), recorderBot: BOT, contexts: [CTX] };
  const got = await fetchCandidates(o);
  assert.deepEqual(
    got.map((c) => c.sha),
    [sha('3'), sha('2')],
  );
  assert.deepEqual(got[1].statuses[0], {
    context: CTX,
    state: 'success',
    description: 'd',
    creator: BOT,
  });
  assert.ok(!calls.some((c) => c.includes(sha('1')) || c.includes(`${sha('4')}/statuses`)));
  // limit
  assert.equal((await fetchCandidates({ ...o, limit: 1 })).length, 1);
  // 응답 형식이 다르면 예외(이어받지 않는다)
  await assert.rejects(fetchCandidates({ ...o, api: async () => ({}) }), /배열이 아니다/);
});

test('oneLine: 줄바꿈·제어 문자를 공백으로(기록 job 로그에 워크플로 명령 줄이 생기지 않게)', () => {
  assert.equal(oneLine('a\n::add-mask::x\r\n\u001b[31mb\tc'), 'a ::add-mask::x [31mb c');
});
