// 승인 결속(scripts/ci/binding.ts, 10.3절): patch-id와 승인 이어받기.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import {
  carryOver,
  changedOnBaseSince,
  patchId,
  patchOf,
  withPatch,
  type Candidate,
} from '../ci/binding.ts';
import { recordReview } from '../ci/record.ts';
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

test('withPatch·patchOf: description 끝에 patch 앞 16자를 붙이고 140자를 넘기지 않는다', () => {
  const id = 'ab12'.repeat(10);
  const d = withPatch('승인 (지적 없음)', id);
  assert.equal(d, '승인 (지적 없음) patch:ab12ab12ab12ab12');
  assert.equal(patchOf(d), 'ab12ab12ab12ab12');
  const long = withPatch('가'.repeat(200), id);
  assert.ok(long.length <= 140);
  assert.equal(patchOf(long), 'ab12ab12ab12ab12');
  assert.equal(patchOf('승인 (지적 없음)'), null);
  assert.equal(patchOf('patch:ab12ab12ab12ab12 뒤에 글'), null);
  assert.equal(patchOf('x patch:ZZ12ab12ab12ab12'), null);
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
  assert.match(no(carry({ changedOnBaseSince: () => ['x.txt', 'a.txt'] })), /겹친다/);
  assert.match(no(carry({ changedOnBaseSince: () => null })), /조회|조상/);
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
  assert.equal(patchOf(a.description), PATCH.slice(0, 16));
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
  assert.match(c.description, /^이어받음 111111111111 patch:c0ffee00c0ffee00$/);
  // 원래 SHA나 patch가 없거나 틀리면 error
  assert.equal((await rec({ raw: null, carriedFrom: 'zzz', patch: PATCH })).state, 'error');
  assert.equal((await rec({ raw: null, carriedFrom: '1'.repeat(40) })).state, 'error');
  // 필요 없는 검증자는 이어받기보다 "해당 없음"이 먼저다
  const n = await rec({ needed: false, raw: null, carriedFrom: '1'.repeat(40), patch: PATCH });
  assert.match(n.description, /해당 없음/);
});
