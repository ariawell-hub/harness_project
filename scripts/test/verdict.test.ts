// 판정 검사·시크릿 스캔·검증자 계획·review/* 기록. 계획 20261115-cross-review step0.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { recordReview } from '../ci/record.ts';
import { reviewersFor } from '../ci/review-plan.ts';
import type { StatusPayload } from '../ci/results.ts';
import {
  LIMITS,
  RESOLUTION_ID_RE,
  RESOLUTION_STATUSES,
  SEVERITIES,
  highEntropy,
  secretNeedles,
  validateVerdict,
  verdictStatus,
  type Verdict,
} from '../ci/verdict.ts';
import { HARNESS_ROOT } from './helpers.ts';

// 시크릿 스캐너(gitleaks)가 실제 토큰으로 읽지 않게 조각을 런타임에 이어 붙인다
const FAKE_SECRET = ['sk', 'ant', 'oat01', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].join('-');
const RANDOM_A = ['aB3xK9mQ2pL7', 'vR5tY8wZ1cN4', 'dF6hJ0sG3uE5', 'iO7kQ2wE9rT1'].join('');
const RANDOM_B = ['x8Kq2mZp4Lw7', 'Nv3Rt6YbHc5D', 'g1Jf0SaUe9Mi', 'P2oXyW4zVn8B'].join('');

const finding = (over: Record<string, unknown> = {}) => ({
  severity: 'P2',
  file: 'src/a.ts',
  line: 3,
  title: '이름',
  evidence: '근거',
  suggestion: '제안',
  ...over,
});
const verdict = (over: Record<string, unknown> = {}) => ({
  verdict: 'approve',
  risk: 'normal',
  summary: '문제 없음',
  findings: [],
  ...over,
});

test('validateVerdict: 정상 판정은 통과', () => {
  const v = validateVerdict(verdict({ findings: [finding()] }));
  assert.equal(v.ok, true);
});

test('validateVerdict: 모르는 키·값·길이·건수를 거부한다', () => {
  const bad: unknown[] = [
    null,
    'x',
    [],
    verdict({ extra: 1 }),
    verdict({ verdict: 'lgtm' }),
    verdict({ risk: 'none' }),
    verdict({ summary: 'a'.repeat(LIMITS.summary + 1) }),
    verdict({ findings: 'none' }),
    verdict({ findings: Array.from({ length: LIMITS.findings + 1 }, () => finding()) }),
    verdict({ findings: [finding({ severity: 'P9' })] }),
    verdict({ findings: [finding({ extra: 1 })] }),
    verdict({ findings: [finding({ line: 1.5 })] }),
    verdict({ findings: [finding({ line: -1 })] }),
    verdict({ findings: [finding({ file: 'a'.repeat(LIMITS.file + 1) })] }),
    verdict({ findings: [finding({ title: 3 })] }),
    verdict({ findings: [finding({ evidence: 'a'.repeat(LIMITS.evidence + 1) })] }),
    (() => {
      const v = verdict() as Record<string, unknown>;
      delete v.summary;
      return v;
    })(),
  ];
  for (const raw of bad)
    assert.equal(validateVerdict(raw).ok, false, JSON.stringify(raw)?.slice(0, 80));
});

test('validateVerdict: resolutions는 없으면 빈 배열, 있으면 ID·상태·길이를 검사한다', () => {
  const none = validateVerdict(verdict());
  assert.ok(none.ok);
  assert.deepEqual(none.value.resolutions, []);
  const some = validateVerdict(
    verdict({ resolutions: [{ id: 'F12', status: 'fixed', note: 'a1b2c3d에서 고침' }] }),
  );
  assert.ok(some.ok);
  assert.deepEqual(some.value.resolutions, [
    { id: 'F12', status: 'fixed', note: 'a1b2c3d에서 고침' },
  ]);
  const r = (over: Record<string, unknown>) => ({ id: 'F1', status: 'open', note: '', ...over });
  const bad: unknown[] = [
    verdict({ resolutions: 'none' }),
    verdict({ resolutions: [r({ id: 'f1' })] }),
    verdict({ resolutions: [r({ id: 'F0' })] }),
    verdict({ resolutions: [r({ id: 'F1 ' })] }),
    verdict({ resolutions: [r({ status: 'deferred' })] }),
    verdict({ resolutions: [r({ note: 'a'.repeat(LIMITS.note + 1) })] }),
    verdict({ resolutions: [r({ extra: 1 })] }),
    verdict({ resolutions: Array.from({ length: LIMITS.resolutions + 1 }, () => r({})) }),
  ];
  for (const raw of bad)
    assert.equal(validateVerdict(raw).ok, false, JSON.stringify(raw)?.slice(0, 120));
});

test('validateVerdict: repro는 없으면 빈 값, 있으면 길이와 개수를 검사한다', () => {
  const none = validateVerdict(verdict({ findings: [finding()] }));
  assert.ok(none.ok);
  assert.deepEqual(none.value.findings[0].repro, { path: '', content: '' });
  const r = { path: 'scripts/test/harness-repro-a.test.ts', content: "test('x', () => {});" };
  const some = validateVerdict(verdict({ findings: [finding({ repro: r })] }));
  assert.ok(some.ok);
  assert.deepEqual(some.value.findings[0].repro, r);
  const bad: unknown[] = [
    verdict({ findings: [finding({ repro: 'x' })] }),
    verdict({ findings: [finding({ repro: { path: 'a' } })] }),
    verdict({ findings: [finding({ repro: { ...r, extra: 1 } })] }),
    verdict({ findings: [finding({ repro: { ...r, path: 'a'.repeat(LIMITS.reproPath + 1) } })] }),
    verdict({
      findings: [finding({ repro: { ...r, content: 'a'.repeat(LIMITS.reproContent + 1) } })],
    }),
    // 재현 테스트는 판정 하나에 LIMITS.repros개까지다(job 출력 크기)
    verdict({
      findings: Array.from({ length: LIMITS.repros + 1 }, () => finding({ repro: r })),
    }),
  ];
  for (const raw of bad)
    assert.equal(validateVerdict(raw).ok, false, JSON.stringify(raw)?.slice(0, 120));
  assert.equal(
    validateVerdict(
      verdict({ findings: Array.from({ length: LIMITS.repros }, () => finding({ repro: r })) }),
    ).ok,
    true,
  );
});

test('스키마 파일과 코드 규칙이 같다', () => {
  const s = JSON.parse(
    readFileSync(path.join(HARNESS_ROOT, 'scripts/cross-review/verdict.schema.json'), 'utf8'),
  );
  assert.equal(s.additionalProperties, false);
  // Codex 구조화 출력은 모든 속성이 required여야 한다. 검사기는 resolutions가 없어도 받는다
  assert.deepEqual([...s.required].sort(), [
    'findings',
    'resolutions',
    'risk',
    'summary',
    'verdict',
  ]);
  const r = s.properties.resolutions;
  assert.equal(r.maxItems, LIMITS.resolutions);
  assert.equal(r.items.additionalProperties, false);
  assert.deepEqual([...r.items.required].sort(), ['id', 'note', 'status']);
  assert.deepEqual(r.items.properties.status.enum, [...RESOLUTION_STATUSES]);
  assert.equal(r.items.properties.note.maxLength, LIMITS.note);
  assert.equal(r.items.properties.id.pattern, RESOLUTION_ID_RE.source);
  assert.deepEqual(s.properties.verdict.enum, ['approve', 'request_changes']);
  assert.deepEqual(s.properties.risk.enum, ['low', 'normal', 'high']);
  assert.equal(s.properties.summary.maxLength, LIMITS.summary);
  assert.equal(s.properties.findings.maxItems, LIMITS.findings);
  const f = s.properties.findings.items;
  assert.equal(f.additionalProperties, false);
  assert.deepEqual([...f.required].sort(), [
    'evidence',
    'file',
    'line',
    'repro',
    'severity',
    'suggestion',
    'title',
  ]);
  const rp = f.properties.repro;
  assert.equal(rp.additionalProperties, false);
  assert.deepEqual([...rp.required].sort(), ['content', 'path']);
  assert.equal(rp.properties.path.maxLength, LIMITS.reproPath);
  assert.equal(rp.properties.content.maxLength, LIMITS.reproContent);
  assert.deepEqual(f.properties.severity.enum, [...SEVERITIES]);
  for (const k of ['file', 'title', 'evidence', 'suggestion'] as const)
    assert.equal(f.properties[k].maxLength, LIMITS[k], k);
});

test('secretNeedles: 원문·인코딩·16자 조각을 찾고, 짧은 값은 원문만', () => {
  const secret = FAKE_SECRET;
  const has = secretNeedles([secret]);
  const b = Buffer.from(secret);
  for (const t of [
    secret,
    b.toString('base64'),
    b.toString('base64url'),
    b.toString('hex'),
    b.toString('hex').toUpperCase(),
    encodeURIComponent('a b/' + secret).slice(6),
    `앞 ${secret.slice(10, 26)} 뒤`,
  ])
    assert.equal(has(t), true, t.slice(0, 20));
  assert.equal(has('아무 문제 없는 검토 의견이다'), false);
  assert.equal(has(secret.slice(0, 15)), false);
  const short = secretNeedles(['abc123']);
  assert.equal(short('x abc123 y'), true);
  assert.equal(short('abc12'), false);
  assert.equal(secretNeedles([])('anything'), false);
  assert.equal(secretNeedles([''])('anything'), false);
});

test('highEntropy: 긴 무작위 토큰만 잡는다', () => {
  assert.equal(highEntropy(`토큰 ${RANDOM_A} 발견`), true);
  assert.equal(highEntropy(RANDOM_B), true);
  assert.equal(highEntropy('커밋 7b837e7b68412d6259a195e13e51858478e2f024 참고'), false);
  assert.equal(highEntropy('src/components/authentication/LoginFormContainer.tsx:42'), false);
  assert.equal(highEntropy('만료 토큰을 허용한다. validateToken()이 exp를 보지 않는다'), false);
  assert.equal(highEntropy('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'), false);
});

test('verdictStatus: 승인이고 P0·P1이 없을 때만 success', () => {
  const st = (v: Record<string, unknown>) => verdictStatus(v as unknown as Verdict);
  assert.equal(st(verdict()).state, 'success');
  assert.equal(
    st(verdict({ findings: [finding(), finding({ severity: 'P3' })] })).state,
    'success',
  );
  assert.equal(st(verdict({ findings: [finding({ severity: 'P1' })] })).state, 'failure');
  assert.equal(st(verdict({ verdict: 'request_changes' })).state, 'failure');
  assert.match(
    st(verdict({ findings: [finding({ severity: 'P0' }), finding()] })).description,
    /P0 1.*P2 1/,
  );
});

test('verdictStatus(Issue #262·#267): 차단 지적이 모두 원장이 미루는 P1이고 resolutions에 open이 없으면 success', () => {
  // deferred: 원장의 등록 규칙이 미루는 지적인가(이 테스트는 src/main-only.ts의 지적과 1번 지적을 미룬다고 본다)
  const deferred = (f: { file: string }, i: number) => f.file === 'src/main-only.ts' || i === 1;
  const st = (v: Record<string, unknown>, d?: (f: { file: string }, i: number) => boolean) =>
    verdictStatus(v as unknown as Verdict, d);
  const out = finding({ severity: 'P1', file: 'src/main-only.ts' });
  const inside = finding({ severity: 'P1', file: 'src/a.ts' });
  const p0 = finding({ severity: 'P0', file: 'src/main-only.ts' });
  const only = st(verdict({ verdict: 'request_changes', findings: [out, finding()] }), deferred);
  assert.equal(only.state, 'success');
  assert.match(only.description, /^승인 \(미룬 P1 1, P1 1, P2 1\)$/);
  // 순번으로도 판단한다: 1번(src/a.ts)도 미룬다
  assert.equal(
    st(verdict({ verdict: 'request_changes', findings: [out, inside] }), deferred).state,
    'success',
  );
  const cases: [string, Record<string, unknown>][] = [
    ['미루지 않는 P1이 함께', verdict({ verdict: 'request_changes', findings: [inside, out] })],
    ['P0은 미뤄도 막는다', verdict({ verdict: 'request_changes', findings: [out, p0] })],
    [
      'resolutions에 open',
      verdict({
        verdict: 'request_changes',
        findings: [out],
        resolutions: [{ id: 'F1', status: 'open', note: '' }],
      }),
    ],
    ['차단 지적 없이 request_changes', verdict({ verdict: 'request_changes' })],
  ];
  for (const [name, v] of cases) assert.equal(st(v, deferred).state, 'failure', name);
  // 판단 함수가 없으면 지금 규칙이다
  assert.equal(st(verdict({ verdict: 'request_changes', findings: [out] })).state, 'failure');
});

test('reviewersFor: 낮음은 다른 도구 1명, 보통·높음은 둘 다(10.1절)', () => {
  assert.deepEqual(reviewersFor('low', 'claude-code'), { claude: false, codex: true });
  assert.deepEqual(reviewersFor('low', 'codex'), { claude: true, codex: false });
  assert.deepEqual(reviewersFor('low', 'someone'), { claude: false, codex: true });
  assert.deepEqual(reviewersFor('low', ''), { claude: false, codex: true });
  for (const r of ['normal', 'high'] as const)
    for (const a of ['claude-code', 'codex', 'someone'])
      assert.deepEqual(reviewersFor(r, a), { claude: true, codex: true });
});

const SHA = 'a'.repeat(40);
async function rec(over: Partial<Parameters<typeof recordReview>[0]>): Promise<StatusPayload> {
  const posted: StatusPayload[] = [];
  await recordReview({
    context: 'review/claude',
    needed: true,
    raw: JSON.stringify(verdict()),
    secrets: [],
    headSha: SHA,
    repo: 'o/r',
    post: async (p) => void posted.push(p),
    ...over,
  });
  assert.equal(posted.length, 1);
  return posted[0];
}

test('recordReview: 해당 없음, 승인, 차단 지적, 변경 요청', async () => {
  const na = await rec({ needed: false, raw: null });
  assert.deepEqual([na.context, na.state], ['review/claude', 'success']);
  assert.match(na.description, /해당 없음/);
  assert.equal((await rec({})).state, 'success');
  assert.equal((await rec({ context: 'review/codex' })).context, 'review/codex');
  assert.equal(
    (await rec({ raw: JSON.stringify(verdict({ findings: [finding({ severity: 'P1' })] })) }))
      .state,
    'failure',
  );
  assert.equal(
    (await rec({ raw: JSON.stringify(verdict({ verdict: 'request_changes' })) })).state,
    'failure',
  );
});

test('recordReview: 판정 없음·깨짐·비밀·고엔트로피는 error, 사유에 값을 넣지 않는다', async () => {
  const secret = FAKE_SECRET;
  for (const raw of [null, '', '{', JSON.stringify({ verdict: 'approve' })])
    assert.equal((await rec({ raw })).state, 'error');
  const leak = await rec({
    raw: JSON.stringify(verdict({ summary: `토큰 ${secret.slice(5, 30)}` })),
    secrets: [secret],
  });
  assert.equal(leak.state, 'error');
  assert.ok(!leak.description.includes(secret.slice(5, 21)));
  const ent = await rec({
    raw: JSON.stringify(verdict({ summary: RANDOM_A })),
  });
  assert.equal(ent.state, 'error');
});

test('recordReview: 모르는 context·repo·sha는 예외이고 아무것도 쓰지 않는다', async () => {
  for (const bad of [{ context: 'plan-gate' }, { repo: 'x' }, { headSha: 'abc' }]) {
    const posted: StatusPayload[] = [];
    await assert.rejects(
      recordReview({
        context: 'review/claude',
        needed: true,
        raw: JSON.stringify(verdict()),
        secrets: [],
        headSha: SHA,
        repo: 'o/r',
        post: async (p) => void posted.push(p),
        ...bad,
      }),
    );
    assert.equal(posted.length, 0);
  }
});
