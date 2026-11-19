// verify의 거부 프록시와 공개 증거 요약(계획 20261119-pilot-prep 수용 기준 5·6·8).
// 실제 외부 주소로는 아무것도 보내지 않는다: 대상은 테스트가 띄운 로컬 서버나 example.test(프록시가 전달하지 않는다)다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../lib/config.ts';
import { runSync } from '../lib/exec.ts';
import { startDenyProxy, type DenyProxy } from '../verify/deny-proxy.ts';
import { buildEvidence } from '../verify/evidence.ts';
import { judge, type Observation, type ScenarioVerdict, type Verdict } from '../verify/judge.ts';
import { DEFAULT_RUNNER, verifyWeb } from '../verify/web.ts';
import { fixtureConfig, gitInit, HARNESS_ROOT, tmp, write } from './helpers.ts';

/** 어디에도 새면 안 되는 표식. 호스트 이름에도 넣으므로 소문자와 숫자만 쓴다 */
const MARK = 'zqleakmark7f3a9c';
const UNKNOWN = '(알 수 없음)';
const T = { timeout: 120_000 };

const portOf = (url: string) => Number(new URL(url).port);
const connects = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = net.connect(port, '127.0.0.1');
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });

/** 프록시에 요청 하나를 보내고 연결이 닫힐 때까지 기다린다. 응답이 없이 닫히면 status는 null이다 */
function send(
  port: number,
  o: { method?: string; path: string; headers?: http.OutgoingHttpHeaders },
): Promise<{ status: number | null }> {
  return new Promise((resolve) => {
    let status: number | null = null;
    const req = http.request({
      host: '127.0.0.1',
      port,
      method: o.method ?? 'GET',
      path: o.path,
      headers: o.headers,
      agent: false,
    });
    req.on('socket', (s) => s.once('close', () => resolve({ status })));
    req.on('response', (res) => {
      status = res.statusCode ?? null;
      res.resume();
    });
    // CONNECT와 업그레이드: 받은 쪽에서 소켓을 닫지 않는다. 프록시가 닫아야 끝난다
    const keep = (res: http.IncomingMessage, socket: net.Socket) => {
      status = res.statusCode ?? null;
      socket.resume();
    };
    req.on('connect', keep);
    req.on('upgrade', keep);
    req.on('error', () => {});
    req.end();
  });
}

/** 글자 그대로 보낸다(Node 클라이언트가 만들지 못하는 요청용). 받은 글자와 함께 닫힘을 기다린다 */
function raw(port: number, text: string): Promise<string> {
  return new Promise((resolve) => {
    let got = '';
    const s = net.connect(port, '127.0.0.1', () => {
      if (text) s.write(text);
      else s.end();
    });
    s.on('data', (d) => (got += d.toString('latin1')));
    s.once('close', () => resolve(got));
    s.on('error', () => {});
  });
}

async function withProxy(fn: (p: DenyProxy, port: number) => Promise<void>): Promise<void> {
  const p = await startDenyProxy();
  try {
    await fn(p, portOf(p.url));
  } finally {
    await p.close();
  }
}

// ---------- 거부 프록시 ----------

test('거부 프록시: 127.0.0.1에서만 뜬다', T, async () => {
  await withProxy(async (p) => {
    assert.match(p.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.deepEqual(p.denied(), []);
    assert.equal(p.count(), 0);
  });
});

test(
  '거부 프록시: 일반 요청·CONNECT·업그레이드를 거부하고 종류·호스트·포트만 기록한다',
  T,
  async () => {
    await withProxy(async (p, port) => {
      const plain = await send(port, {
        path: `http://example.test:8080/path-${MARK}?token=${MARK}`,
        headers: { Host: 'example.test:8080', Authorization: MARK, Cookie: `s=${MARK}` },
      });
      assert.equal(plain.status, 403);
      const connect = await send(port, {
        method: 'CONNECT',
        path: 'example.test:443',
        headers: { 'Proxy-Authorization': MARK },
      });
      assert.equal(connect.status, 403);
      const upgrade = await send(port, {
        path: `http://example.test:8081/ws-${MARK}`,
        headers: { Host: 'example.test:8081', Connection: 'Upgrade', Upgrade: 'websocket' },
      });
      assert.equal(upgrade.status, null);
      assert.deepEqual(p.denied(), [
        { kind: 'http', host: 'example.test', port: 8080 },
        { kind: 'connect', host: 'example.test', port: 443 },
        { kind: 'upgrade', host: 'example.test', port: 8081 },
      ]);
      assert.equal(p.count(), 3);
      assert.equal(JSON.stringify(p.denied()).includes(MARK), false);
    });
  },
);

test(
  '거부 프록시: 대상은 요청 줄이나 Host에서 호스트와 포트만 읽고, 읽지 못하면 알 수 없음이다',
  T,
  async () => {
    const cases: [string, { kind: string; host: string; port: number }][] = [
      // 절대 URL: 스킴의 기본 포트
      [
        'GET http://a.example.test/x HTTP/1.1\r\nHost: a.example.test\r\n\r\n',
        hp('a.example.test', 80),
      ],
      [
        'GET https://a.example.test/x HTTP/1.1\r\nHost: a.example.test\r\n\r\n',
        hp('a.example.test', 443),
      ],
      // 사용자 정보는 버리고, 대문자는 소문자로 적는다
      [
        `GET http://user:${MARK}@B.Example.TEST:81/ HTTP/1.1\r\nHost: x\r\n\r\n`,
        hp('b.example.test', 81),
      ],
      ['GET http://[::1]:9/ HTTP/1.1\r\nHost: x\r\n\r\n', hp('[::1]', 9)],
      // 경로만 온 요청은 Host를 본다
      [`GET /p-${MARK} HTTP/1.1\r\nHost: c.example.test:82\r\n\r\n`, hp('c.example.test', 82)],
      // 호스트로 볼 수 없는 글자, 범위를 넘는 포트, Host 없음
      [`GET http://bad_${MARK}!host/ HTTP/1.1\r\nHost: x\r\n\r\n`, hp(UNKNOWN, 0)],
      ['GET http://a.example.test:70000/ HTTP/1.1\r\nHost: x\r\n\r\n', hp(UNKNOWN, 0)],
      [`GET /p-${MARK} HTTP/1.0\r\n\r\n`, hp(UNKNOWN, 0)],
      [`GET /p HTTP/1.1\r\nHost: <${MARK}>\r\n\r\n`, hp(UNKNOWN, 0)],
      [
        'CONNECT d.example.test:8443 HTTP/1.1\r\nHost: d.example.test:8443\r\n\r\n',
        { kind: 'connect', host: 'd.example.test', port: 8443 },
      ],
      [
        `CONNECT bad!${MARK}:443 HTTP/1.1\r\nHost: x\r\n\r\n`,
        { kind: 'connect', host: UNKNOWN, port: 0 },
      ],
      // 포트가 없는 CONNECT 대상
      [
        'CONNECT f.example.test HTTP/1.1\r\nHost: x\r\n\r\n',
        { kind: 'connect', host: 'f.example.test', port: 0 },
      ],
      // 기본 포트를 모르는 스킴은 0이다(객체에서 물려받은 이름과 같은 스킴 포함)
      ['GET constructor://g.example.test/ HTTP/1.1\r\nHost: x\r\n\r\n', hp('g.example.test', 0)],
      ['GET ftp://g.example.test/ HTTP/1.1\r\nHost: x\r\n\r\n', hp('g.example.test', 0)],
      // 깨진 요청도 닿은 것으로 센다
      [`${MARK} garbage\r\n\r\n`, hp(UNKNOWN, 0)],
    ];
    await withProxy(async (p, port) => {
      for (const [text] of cases) await raw(port, text);
      assert.deepEqual(
        p.denied(),
        cases.map(([, want]) => want),
      );
      assert.equal(JSON.stringify(p.denied()).includes(MARK), false);
      // 포트는 언제나 0~65535의 정수다. JSON으로 바꿔도 빠지는 칸이 없다
      for (const d of p.denied())
        assert.equal(Number.isInteger(d.port) && d.port >= 0 && d.port <= 65535, true);
      assert.deepEqual(JSON.parse(JSON.stringify(p.denied())), p.denied());
      // 아무것도 보내지 않고 끊은 연결은 요청이 아니다
      await raw(port, '');
      const before = p.count();
      await send(port, { path: 'http://e.example.test/' });
      assert.equal(p.count(), before + 1);
      assert.equal(before, cases.length);
    });
  },
);
function hp(host: string, port: number) {
  return { kind: 'http', host, port };
}

test('거부 프록시: 어디로도 전달하지 않는다(대상 서버에 닿는 연결이 0이다)', T, async () => {
  let reached = 0;
  const target = net.createServer((s) => {
    reached++;
    s.destroy();
  });
  await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
  const tport = (target.address() as net.AddressInfo).port;
  try {
    await withProxy(async (p, port) => {
      const plain = await send(port, {
        path: `http://127.0.0.1:${tport}/x`,
        headers: { Host: `127.0.0.1:${tport}` },
      });
      assert.equal(plain.status, 403);
      const post = await raw(
        port,
        `POST http://127.0.0.1:${tport}/x HTTP/1.1\r\nHost: 127.0.0.1:${tport}\r\nContent-Length: 5\r\n\r\nhello`,
      );
      assert.match(post, /^HTTP\/1\.1 403 /);
      const connect = await raw(
        port,
        `CONNECT 127.0.0.1:${tport} HTTP/1.1\r\nHost: 127.0.0.1:${tport}\r\n\r\nGET / HTTP/1.1\r\nHost: x\r\n\r\n`,
      );
      assert.match(connect, /^HTTP\/1\.1 403 /);
      const upgrade = await send(port, {
        path: `http://127.0.0.1:${tport}/ws`,
        headers: { Host: `127.0.0.1:${tport}`, Connection: 'Upgrade', Upgrade: 'websocket' },
      });
      assert.equal(upgrade.status, null);
      assert.equal(p.count(), 4);
      assert.deepEqual(
        p.denied().map((d) => `${d.host}:${d.port}`),
        Array<string>(4).fill(`127.0.0.1:${tport}`),
      );
    });
    assert.equal(reached, 0);
  } finally {
    await new Promise<void>((r) => target.close(() => r()));
  }
});

test(
  '거부 프록시: 기록은 1000건까지 담고 건수는 끝까지 센다. close 뒤에는 포트가 닫힌다',
  T,
  async () => {
    const p = await startDenyProxy();
    const port = portOf(p.url);
    try {
      for (let done = 0; done < 1001;) {
        const n = Math.min(40, 1001 - done);
        const got = await Promise.all(
          Array.from({ length: n }, (_, k) =>
            send(port, { path: `http://h${done + k}.example.test/` }),
          ),
        );
        for (const g of got) assert.equal(g.status, 403);
        done += n;
      }
      assert.equal(p.denied().length, 1000);
      assert.equal(p.count(), 1001);
      // 돌려준 배열을 고쳐도 기록은 그대로다
      p.denied().length = 0;
      assert.equal(p.denied().length, 1000);
      // 열어 둔 채 아무것도 보내지 않는 연결이 있어도 close가 끝난다
      const idle = net.connect(port, '127.0.0.1');
      await new Promise<void>((r) => idle.once('connect', () => r()));
      const idleClosed = new Promise<void>((r) => idle.once('close', () => r()));
      idle.on('error', () => {});
      await p.close();
      await idleClosed;
      assert.equal(await connects(port), false);
      // 두 번 불러도 된다
      await p.close();
    } finally {
      await p.close();
    }
  },
);

// ---------- buildEvidence ----------

const OBS: Observation = {
  version: 1,
  consoleErrors: [],
  failedRequests: [],
  allowed: { consoleErrors: 0, failedRequests: 0 },
};
const scenario = (over: Partial<ScenarioVerdict> = {}): ScenarioVerdict => ({
  file: 'e2e/a.spec.ts',
  line: 3,
  title: 'works [chromium]',
  status: 'passed',
  ok: true,
  problems: [],
  observation: OBS,
  ...over,
});
const PASS: Verdict = { ok: true, scenarios: [scenario()], problems: [] };
const META = { startedAt: '2026-11-19T01:02:03.000Z', deniedCount: 0 };

/** 실제 폴더의 출력 폴더 하나(`local/` 포함) */
function outDir(): string {
  const dir = path.join(tmp('harness-evidence-'), 'out');
  mkdirSync(path.join(dir, 'local'), { recursive: true });
  return realpathSync(dir);
}
interface Summary {
  version: number;
  startedAt: string;
  ok: boolean;
  scenarioCount: number;
  deniedCount: number;
  scenarios: {
    file: string;
    line: number;
    status: string;
    ok: boolean;
    observation: boolean;
    consoleErrors: number | null;
    failedRequests: number | null;
    blockedRequests: number | null;
    allowedConsoleErrors: number | null;
    allowedFailedRequests: number | null;
  }[];
  problems: { category: string; count: number }[];
}
function built(verdict: Verdict, meta = META) {
  const dir = outDir();
  const e = buildEvidence(dir, verdict, meta);
  const json = readFileSync(path.join(e.dir, 'summary.json'), 'utf8');
  const md = readFileSync(path.join(e.dir, 'summary.md'), 'utf8');
  return { out: dir, e, json, md, summary: JSON.parse(json) as Summary };
}

test('buildEvidence: evidence/에 summary.json과 summary.md 둘만 만든다(통과·실패·결과 파일 없음)', () => {
  const noReport: Verdict = {
    ok: false,
    scenarios: [],
    problems: ['실행기가 결과 파일(report.json)을 쓰지 않았다(실행기 종료 코드 0)'],
  };
  const fail: Verdict = {
    ok: false,
    scenarios: [
      scenario({ status: 'failed', ok: false, problems: ['상태가 passed가 아니다: failed'] }),
    ],
    problems: [],
  };
  for (const [v, ok] of [
    [PASS, true],
    [fail, false],
    [noReport, false],
  ] as const) {
    const b = built(v);
    assert.equal(b.e.dir, path.join(b.out, 'evidence'));
    assert.deepEqual(b.e.files, ['summary.json', 'summary.md']);
    assert.deepEqual(readdirSync(b.e.dir).sort(), ['summary.json', 'summary.md']);
    assert.equal(b.summary.ok, ok);
    assert.equal(b.summary.version, 1);
    assert.equal(b.summary.startedAt, META.startedAt);
    assert.equal(b.summary.scenarioCount, v.scenarios.length);
    assert.match(b.md, ok ? /verify: 통과/ : /verify: 실패/);
    assert.match(b.md, /\| 시나리오 \|/);
    // local/에는 아무것도 쓰지 않는다
    assert.deepEqual(readdirSync(path.join(b.out, 'local')), []);
  }
  assert.deepEqual(built(noReport).summary.problems, [
    { category: '결과 파일 읽지 못함', count: 1 },
  ]);
});

test('buildEvidence: 건수가 그대로 들어간다', () => {
  const observation: Observation = {
    version: 1,
    consoleErrors: [{ text: 'a' }, { text: 'b' }],
    failedRequests: [
      { url: 'http://127.0.0.1:1/a', reason: '500', blocked: false },
      { url: 'http://127.0.0.1:1/b', reason: '404', blocked: false },
      { url: 'https://ext.example.test/', reason: 'blocked', blocked: true },
    ],
    allowed: { consoleErrors: 1, failedRequests: 0 },
  };
  const v: Verdict = {
    ok: false,
    scenarios: [
      scenario({ ok: false, observation, problems: ['콘솔 에러 2건: a | b'] }),
      scenario({
        file: 'e2e/b.spec.ts',
        line: 7,
        observation: null,
        ok: false,
        status: 'timedOut',
      }),
    ],
    problems: [],
  };
  const b = built(v, { ...META, deniedCount: 4 });
  assert.equal(b.summary.deniedCount, 4);
  assert.equal(b.summary.scenarioCount, 2);
  assert.deepEqual(b.summary.scenarios, [
    {
      file: 'e2e/a.spec.ts',
      line: 3,
      status: 'passed',
      ok: false,
      observation: true,
      consoleErrors: 2,
      failedRequests: 3,
      blockedRequests: 1,
      allowedConsoleErrors: 1,
      allowedFailedRequests: 0,
    },
    {
      file: 'e2e/b.spec.ts',
      line: 7,
      status: 'timedOut',
      ok: false,
      observation: false,
      consoleErrors: null,
      failedRequests: null,
      blockedRequests: null,
      allowedConsoleErrors: null,
      allowedFailedRequests: null,
    },
  ]);
  assert.match(
    b.md,
    /\| `e2e\/a\.spec\.ts:3` \| passed \| 실패 \| 2 \| 3 \| 1 \| 1 \| 0 \| 있음 \|/,
  );
  assert.match(
    b.md,
    /\| `e2e\/b\.spec\.ts:7` \| timedOut \| 실패 \| - \| - \| - \| - \| - \| 없음 \|/,
  );
  assert.match(b.md, /거부 프록시에 닿은 요청 4건/);
});

test('buildEvidence: 시나리오 경로 규칙에 맞는 경로만 적고 정해 둔 상태만 적는다', () => {
  const v: Verdict = {
    ok: false,
    scenarios: [
      scenario(),
      scenario({ file: 'e2e/[id].spec.ts' }),
      scenario({ file: 'e2e/a b.spec.ts' }),
      scenario({ file: 'e2e/(shop)/a.spec.ts' }),
      scenario({ file: '' }),
      scenario({ file: 'src/a.spec.ts' }),
      ...['failed', 'timedOut', 'skipped', 'interrupted', '', 'passed\n', '객체'].map((status) =>
        scenario({ status }),
      ),
    ],
    problems: [],
  };
  const b = built(v);
  assert.deepEqual(
    b.summary.scenarios.slice(0, 6).map((s) => s.file),
    ['e2e/a.spec.ts', ...Array<string>(5).fill('(경로 생략)')],
  );
  assert.deepEqual(
    b.summary.scenarios.slice(6).map((s) => s.status),
    ['failed', 'timedOut', 'skipped', 'interrupted', UNKNOWN, UNKNOWN, UNKNOWN],
  );
  assert.match(b.md, /\| `e2e\/a\.spec\.ts:3` \|/);
  assert.match(b.md, /\| \(경로 생략\) \|/);
  assert.equal(b.md.includes('[id]'), false);
  assert.equal(b.md.includes('a b.spec'), false);
});

test('buildEvidence: 전체 문제는 분류와 건수로만 적는다', () => {
  const root = path.resolve('/repo');
  const fromJudge = [
    ...judge({ config: { rootDir: 1 }, suites: [], errors: [{ message: MARK }] }, 2, {
      root,
      scenarios: ['e2e/a.spec.ts'],
    }).problems,
    ...judge(null, 0, { root }).problems,
  ];
  const v: Verdict = {
    ok: false,
    scenarios: [],
    problems: [
      ...fromJudge,
      `dev가 준비되기 전에 끝났다(종료 코드 3)\ndev.log 끝부분:\n${MARK}`,
      `dev가 1초 안에 http://127.0.0.1:1에서 응답하지 않았다\ndev.log 끝부분:\n${MARK}`,
      '실행기가 900초 안에 끝나지 않아 중단했다',
      '중단 신호를 받았다',
      '띄운 프로세스를 끝내지 못했다(dev 또는 실행기의 프로세스가 남아 있다)',
      `앱 주소 밖으로 가려는 요청 2건: ${MARK}.example.test:443`,
      '결과 파일(report.json)을 JSON으로 읽지 못했다(실행기 종료 코드 0)',
      '결과 파일(report.json)이 일반 파일이 아니다(실행기 종료 코드 0)',
      `시나리오 파일이 없다: e2e/${MARK}.spec.ts`,
      'commands.dev가 없다. verify는 dev로 앱을 띄운다.',
      `verify를 끝내지 못했다: ${MARK}`,
      `${MARK} 처음 보는 문장`,
    ],
  };
  const b = built(v);
  const got = Object.fromEntries(b.summary.problems.map((p) => [p.category, p.count]));
  assert.deepEqual(got, {
    '실행기 종료 코드 0 아님': 1,
    '결과 파일 형식 오류': 2,
    '실행기가 보고한 오류': 1,
    '시나리오 없음': 1,
    '시나리오 집합 불일치': 1,
    'dev 준비 실패': 2,
    '실행기 시간 초과': 1,
    '중단 신호': 1,
    '정리 실패': 1,
    '앱 주소 밖 요청': 1,
    '결과 파일 읽지 못함': 2,
    '시나리오 지정 오류': 1,
    'dev 명령 없음': 1,
    '내부 오류': 1,
    기타: 1,
  });
  assert.equal(
    b.summary.problems.reduce((n, p) => n + p.count, 0),
    v.problems.length,
  );
  assert.equal((b.json + b.md).includes(MARK), false);
  assert.match(b.md, /전체 문제\(분류별\): .*시나리오 없음 1건/);
});

test('buildEvidence: 실행 중에 만들어진 문자열은 어디에도 들어가지 않는다', () => {
  const observation: Observation = {
    version: 1,
    consoleErrors: [{ text: `console ${MARK}` }],
    failedRequests: [
      { url: `https://${MARK}.example.test/p`, reason: 'x', blocked: true },
      { url: `http://127.0.0.1:1/${MARK}`, reason: MARK, blocked: false },
      { url: `http://127.0.0.1:1/p?token=${MARK}`, reason: '500', blocked: false },
    ],
    allowed: { consoleErrors: 0, failedRequests: 0 },
  };
  const v: Verdict = {
    ok: false,
    scenarios: [
      scenario({
        title: `title ${MARK}`,
        observation,
        ok: false,
        problems: [`콘솔 에러 1건: ${MARK}`],
      }),
      scenario({ file: `e2e/[${MARK}].spec.ts`, status: MARK }),
      scenario({ file: `${MARK}/a.spec.ts`, status: `passed ${MARK}` }),
    ],
    problems: [`앱 주소 밖으로 가려는 요청 1건: ${MARK}.example.test:443`, MARK],
  };
  const b = built(v, { startedAt: MARK, deniedCount: 1 });
  assert.equal((b.json + b.md).toLowerCase().includes(MARK), false);
  assert.equal(b.summary.startedAt, UNKNOWN);
  assert.equal(b.summary.scenarioCount, 3);
});

test('buildEvidence: evidence 자리에 이미 무언가 있으면 만들지 않는다', () => {
  const planted = outDir();
  mkdirSync(path.join(planted, 'evidence'));
  write(planted, 'evidence/extra.png', 'x');
  assert.throws(() => buildEvidence(planted, PASS, META), /evidence/);
  assert.deepEqual(readdirSync(path.join(planted, 'evidence')), ['extra.png']);
  assert.throws(() => buildEvidence(path.join(planted, 'missing'), PASS, META), /출력 폴더/);
});

// 구현 판정 F3: 요약 둘 가운데 하나만 쓰고 실패하면 공개 경로에 아무것도 남지 않아야 한다
test('buildEvidence: 쓰는 도중 실패하면 evidence/가 생기지 않고 쓰다 만 파일도 남지 않는다', () => {
  for (const failAt of ['summary.json', 'summary.md', 'publish'] as const) {
    const dir = outDir();
    const io = {
      writeFileSync: (file: string, data: string, o: { flag: string }) => {
        if (path.basename(file) === failAt) throw new Error('ENOSPC(시험)');
        writeFileSync(file, data, o);
      },
      renameSync: (from: string, to: string) => {
        if (failAt === 'publish') throw new Error('EIO(시험)');
        renameSync(from, to);
      },
    };
    assert.throws(() => buildEvidence(dir, PASS, META, io), /시험/, failAt);
    assert.deepEqual(readdirSync(dir), ['local'], failAt);
  }
  // 같은 io로 실패가 없으면 평소와 같다
  const dir = outDir();
  const e = buildEvidence(dir, PASS, META, { writeFileSync, renameSync });
  assert.deepEqual(readdirSync(e.dir).sort(), ['summary.json', 'summary.md']);
  assert.deepEqual(readdirSync(dir).sort(), ['evidence', 'local']);
});

// 심볼릭 링크를 만드는 테스트는 macOS·Linux에서만 돈다(Windows에서는 권한이 필요하고 verify도 돌지 않는다)
test('buildEvidence: evidence 자리나 출력 폴더가 심볼릭 링크면 따라가서 쓰지 않는다', () => {
  if (process.platform === 'win32') return;
  const linked = outDir();
  const elsewhere = path.join(tmp('harness-evidence-'), 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, path.join(linked, 'evidence'));
  assert.throws(() => buildEvidence(linked, PASS, META), /evidence/);
  assert.deepEqual(readdirSync(elsewhere), []);

  const real = outDir();
  const alias = path.join(tmp('harness-evidence-'), 'alias');
  symlinkSync(real, alias);
  assert.throws(() => buildEvidence(alias, PASS, META), /출력 폴더/);
  assert.equal(existsSync(path.join(real, 'evidence')), false);
});

// ---------- verifyWeb ----------

/** verifyWeb과 명령행의 테스트는 macOS·Linux에서만 돈다(Windows에서는 verify가 띄우지 않고 실패한다) */
const posixTest = (name: string, fn: () => void | Promise<void>) =>
  test(name, T, async () => {
    if (process.platform !== 'win32') await fn();
  });

interface RunnerCfg {
  /** 프록시로 보낼 요청의 대상(절대 URL) */
  requests?: string[];
  /** 관찰 기록의 allowed에 넣을 수 */
  allowed?: number;
  /** 요청을 보낸 뒤 끝나지 않는다 */
  hang?: boolean;
  /** pass: 통과 보고서, none: 쓰지 않는다, marked: 표식이 곳곳에 든 보고서 */
  report?: 'pass' | 'none' | 'marked';
  /** 출력 폴더의 evidence 자리에 미리 둘 것 */
  plant?: 'file' | 'symlink';
  /** local/detail.json을 지우고 리포 밖을 가리키는 심볼릭 링크로 바꾼다 */
  swapDetail?: boolean;
  /** SIGTERM을 받으면 got-term 파일을 쓰고 버티는 자식을 같은 그룹에 남긴다(정리가 SIGKILL까지 간다) */
  leaveStubborn?: boolean;
}

const DEV = `import http from 'node:http';
http.createServer((req, res) => res.end('fake dev')).listen(Number(process.env.PORT), process.env.HOST);
`;

const runnerScript = (cfg: RunnerCfg) => `const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const CFG = ${JSON.stringify(cfg)};
const MARK = ${JSON.stringify(MARK)};
const out = process.env.HARNESS_VERIFY_OUT;
const proxy = process.env.HARNESS_VERIFY_PROXY ?? null;
function viaProxy(target) {
  return new Promise((resolve) => {
    const u = new URL(proxy);
    const req = http.request({ host: u.hostname, port: u.port, path: target, agent: false });
    req.on('response', (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}
(async () => {
  const statuses = [];
  for (const t of CFG.requests ?? []) statuses.push(await viaProxy(t));
  fs.writeFileSync('runner-seen.json', JSON.stringify({ proxy, statuses }));
  if (CFG.hang) {
    setInterval(() => {}, 1000);
    return;
  }
  if (CFG.plant === 'file') {
    fs.mkdirSync(path.join(out, 'evidence'));
    fs.writeFileSync(path.join(out, 'evidence', 'screenshot.png'), MARK);
  }
  if (CFG.plant === 'symlink') {
    fs.mkdirSync('outside-evidence');
    fs.symlinkSync(path.join(process.cwd(), 'outside-evidence'), path.join(out, 'evidence'));
  }
  if (CFG.swapDetail) {
    fs.unlinkSync(path.join(out, 'local', 'detail.json'));
    fs.symlinkSync(path.join(process.cwd(), 'outside-detail.json'), path.join(out, 'local', 'detail.json'));
  }
  if (CFG.leaveStubborn) {
    const body =
      "const fs = require('node:fs');" +
      "process.on('SIGTERM', () => fs.writeFileSync('got-term', '1'));" +
      "fs.writeFileSync('child-ready', '1'); setInterval(() => {}, 1000);";
    require('node:child_process').spawn(process.execPath, ['-e', body], { stdio: 'ignore' }).unref();
    // 자식이 신호 처리기를 단 뒤에 끝난다
    while (!fs.existsSync('child-ready')) await new Promise((r) => setTimeout(r, 10));
  }
  if (CFG.report === 'none') return;
  const marked = CFG.report === 'marked';
  const allowed = CFG.allowed ?? 0;
  const obs = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
  const clean = { version: 1, consoleErrors: [], failedRequests: [], allowed: { consoleErrors: allowed, failedRequests: allowed } };
  const dirty = {
    version: 1,
    consoleErrors: [{ text: 'console ' + MARK }],
    failedRequests: [
      { url: 'https://' + MARK + '.example.test/p', reason: 'blocked', blocked: true },
      { url: 'http://127.0.0.1:1/' + MARK + '?token=' + MARK, reason: MARK, blocked: false },
    ],
    allowed: { consoleErrors: 0, failedRequests: 0 },
  };
  const spec = (file, title, status, o) => ({
    title,
    file,
    line: 3,
    tests: [
      {
        projectName: 'chromium',
        results: [{ status, attachments: [{ name: 'harness-verify', contentType: 'application/json', body: obs(o) }] }],
      },
    ],
  });
  const specs = marked
    ? [
        spec('a.spec.ts', 'title ' + MARK, 'passed', dirty),
        spec('[' + MARK + '].spec.ts', 'works', 'status-' + MARK, clean),
      ]
    : [spec('a.spec.ts', 'works', 'passed', clean)];
  const report = {
    config: { rootDir: path.join(process.cwd(), 'e2e') },
    suites: [{ title: 'root', specs, suites: [] }],
    errors: marked ? [{ message: 'error ' + MARK }] : [],
  };
  fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report));
})();
`;

const NONE = { setup: null, fmt: null, lint: null, test: null, build: null, verify: null };
interface Fx {
  root: string;
  runner: string[];
}
function fx(cfg: RunnerCfg = {}): Fx {
  const root = path.join(tmp('harness-verify-guard-'), 'r');
  gitInit(root);
  write(root, 'dev.mjs', DEV);
  const script = runnerScript({ report: 'pass', ...cfg });
  write(root, 'fake-runner.cjs', script);
  write(root, DEFAULT_RUNNER[1], script);
  write(root, 'e2e/a.spec.ts', '// 시나리오 자리\n');
  write(
    root,
    'harness.config.json',
    JSON.stringify(
      fixtureConfig({ commands: { ...NONE, dev: { run: 'node dev.mjs', timeoutSec: 60 } } }),
    ),
  );
  return { root, runner: [process.execPath, 'fake-runner.cjs'] };
}
const seen = (root: string) =>
  JSON.parse(readFileSync(path.join(root, 'runner-seen.json'), 'utf8')) as {
    proxy: string | null;
    statuses: number[];
  };
type Result = Awaited<ReturnType<typeof verifyWeb>>;
const allProblems = (r: Result) =>
  [...r.verdict.problems, ...r.verdict.scenarios.flatMap((s) => s.problems)].join('\n');
const run = (f: Fx, o: Parameters<typeof verifyWeb>[2] = {}) =>
  verifyWeb(f.root, loadConfig(f.root), { runner: f.runner, ...o });
const evidenceOf = (r: Result) => {
  const dir = path.join(r.outDir, 'evidence');
  return {
    files: readdirSync(dir).sort(),
    text:
      readFileSync(path.join(dir, 'summary.json'), 'utf8') +
      readFileSync(path.join(dir, 'summary.md'), 'utf8'),
    summary: JSON.parse(readFileSync(path.join(dir, 'summary.json'), 'utf8')) as Summary,
  };
};
const detailOf = (r: Result) => readFileSync(path.join(r.outDir, 'local', 'detail.json'), 'utf8');
async function waitFor(cond: () => boolean, ms: number, what: string): Promise<void> {
  const until = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > until) throw new Error(`기다리다 시간이 지났다: ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const OUTSIDE = 'http://outside.example.test:8080/p';

posixTest(
  'verifyWeb: 프록시에 닿은 요청이 없으면 통과하고, 실행기는 프록시 주소를 받으며, 끝난 뒤 프록시가 닫힌다',
  async () => {
    const f = fx();
    const inherited = process.env.HARNESS_VERIFY_PROXY;
    process.env.HARNESS_VERIFY_PROXY = 'http://127.0.0.1:1';
    let r: Result;
    try {
      r = await run(f);
    } finally {
      if (inherited === undefined) delete process.env.HARNESS_VERIFY_PROXY;
      else process.env.HARNESS_VERIFY_PROXY = inherited;
    }
    assert.equal(r.ok, true, allProblems(r));
    assert.deepEqual(r.denied, { count: 0, requests: [] });
    const proxy = seen(f.root).proxy ?? '';
    assert.match(proxy, /^http:\/\/127\.0\.0\.1:\d+$/);
    // 바깥에서 물려받은 값이 아니고, 앱 주소와 다른 포트다
    assert.notEqual(proxy, 'http://127.0.0.1:1');
    assert.notEqual(proxy, r.baseUrl);
    assert.equal(await connects(portOf(proxy)), false);
    assert.deepEqual(r.evidence, {
      dir: path.join(r.outDir, 'evidence'),
      files: ['summary.json', 'summary.md'],
    });
    const e = evidenceOf(r);
    assert.deepEqual(e.files, ['summary.json', 'summary.md']);
    assert.equal(e.summary.ok, true);
    assert.equal(e.summary.deniedCount, 0);
    assert.deepEqual(
      e.summary.scenarios.map((s) => `${s.file}:${s.line} ${s.status}`),
      ['e2e/a.spec.ts:3 passed'],
    );
    const detail = JSON.parse(detailOf(r)) as { ok: boolean; denied: unknown };
    assert.equal(detail.ok, true);
    assert.deepEqual(detail.denied, { count: 0, requests: [] });
  },
);

posixTest(
  'verifyWeb: 프록시에 닿은 요청이 하나라도 있으면 보고서가 통과여도 실패다(allowed로 뺄 수 없다)',
  async () => {
    for (const allowed of [0, 5]) {
      const f = fx({ requests: [OUTSIDE], allowed });
      const r = await run(f);
      assert.deepEqual(seen(f.root).statuses, [403]);
      assert.equal(r.ok, false);
      assert.equal(r.verdict.ok, false);
      // 시나리오 자신은 통과다: 실패는 프록시 기록에서 온다
      assert.equal(r.verdict.scenarios[0].ok, true);
      assert.deepEqual(r.denied, {
        count: 1,
        requests: [{ kind: 'http', host: 'outside.example.test', port: 8080 }],
      });
      assert.match(allProblems(r), /앱 주소 밖으로 가려는 요청 1건: outside\.example\.test:8080/);
      assert.equal(await connects(portOf(seen(f.root).proxy ?? '')), false);
      const e = evidenceOf(r);
      assert.equal(e.summary.ok, false);
      assert.equal(e.summary.deniedCount, 1);
      assert.deepEqual(e.summary.problems, [{ category: '앱 주소 밖 요청', count: 1 }]);
      assert.equal(e.text.includes('outside.example'), false);
      assert.match(detailOf(r), /outside\.example\.test/);
    }
  },
);

posixTest('verifyWeb: 같은 대상은 문제 문구에 한 번만 적고 건수는 모두 센다', async () => {
  const f = fx({ requests: [OUTSIDE, OUTSIDE, 'http://other.example.test/'] });
  const r = await run(f);
  assert.equal(r.denied.count, 3);
  assert.match(
    allProblems(r),
    /앱 주소 밖으로 가려는 요청 3건: outside\.example\.test:8080, other\.example\.test:80$/m,
  );
});

posixTest(
  'verifyWeb: 실행기가 시간 초과나 중단 신호로 끝나도 프록시가 닫히고 그때까지의 기록이 남는다',
  async () => {
    const timed = fx({ requests: [OUTSIDE], hang: true });
    const r1 = await run(timed, { runnerTimeoutSec: 1 });
    assert.equal(r1.ok, false);
    assert.match(allProblems(r1), /1초 안에 끝나지 않아/);
    assert.match(allProblems(r1), /앱 주소 밖으로 가려는 요청 1건/);
    assert.equal(r1.denied.count, 1);
    assert.equal(await connects(portOf(seen(timed.root).proxy ?? '')), false);
    assert.deepEqual(
      evidenceOf(r1)
        .summary.problems.map((p) => p.category)
        .sort(),
      ['실행기 시간 초과', '앱 주소 밖 요청'].sort(),
    );

    const stopped = fx({ hang: true });
    const ac = new AbortController();
    const pending = run(stopped, { signal: ac.signal });
    await waitFor(
      () => existsSync(path.join(stopped.root, 'runner-seen.json')),
      30_000,
      '실행기 시작',
    );
    ac.abort();
    const r2 = await pending;
    assert.equal(r2.ok, false);
    assert.match(allProblems(r2), /중단 신호/);
    assert.equal(await connects(portOf(seen(stopped.root).proxy ?? '')), false);
    assert.deepEqual(evidenceOf(r2).files, ['summary.json', 'summary.md']);
  },
);

posixTest('verifyWeb: 결과 파일이 없어도 증거 요약과 진단 파일을 만든다', async () => {
  const f = fx({ report: 'none' });
  const r = await run(f);
  assert.equal(r.ok, false);
  const e = evidenceOf(r);
  assert.deepEqual(e.files, ['summary.json', 'summary.md']);
  assert.equal(e.summary.ok, false);
  assert.equal(e.summary.scenarioCount, 0);
  assert.deepEqual(e.summary.problems, [{ category: '결과 파일 읽지 못함', count: 1 }]);
  assert.match(detailOf(r), /결과 파일\(report\.json\)을 쓰지 않았다/);
});

posixTest('verifyWeb: 아무것도 띄우기 전에 실패해도 증거 요약을 만든다', async () => {
  const f = fx();
  const r = await run(f, { scenarios: ['e2e/missing.spec.ts'] });
  assert.equal(r.ok, false);
  assert.equal(existsSync(path.join(f.root, 'runner-seen.json')), false);
  assert.deepEqual(r.denied, { count: 0, requests: [] });
  const e = evidenceOf(r);
  assert.deepEqual(e.files, ['summary.json', 'summary.md']);
  assert.deepEqual(e.summary.problems, [{ category: '시나리오 지정 오류', count: 1 }]);
});

posixTest(
  'verifyWeb: 표식이 제목·콘솔·URL·경로·상태·프록시 요청에 있어도 evidence/에는 없고 local/detail.json에는 있다',
  async () => {
    const f = fx({
      report: 'marked',
      requests: [`http://${MARK}.example.test:8080/${MARK}?t=${MARK}`],
    });
    const r = await run(f);
    assert.equal(r.ok, false);
    assert.equal(r.denied.requests[0].host, `${MARK}.example.test`);
    const e = evidenceOf(r);
    assert.deepEqual(e.files, ['summary.json', 'summary.md']);
    assert.equal(e.text.toLowerCase().includes(MARK), false);
    assert.equal(e.summary.scenarioCount, 2);
    assert.deepEqual(
      e.summary.scenarios.map((s) => [s.file, s.status]),
      [
        ['e2e/a.spec.ts', 'passed'],
        ['(경로 생략)', UNKNOWN],
      ],
    );
    assert.deepEqual(
      e.summary.scenarios.map((s) => [s.consoleErrors, s.failedRequests, s.blockedRequests]),
      [
        [1, 2, 1],
        [0, 0, 0],
      ],
    );
    // 진단용 파일에는 그대로 있다
    const detail = detailOf(r);
    for (const part of [
      `title ${MARK}`,
      `console ${MARK}`,
      `${MARK}.example.test`,
      `?token=${MARK}`,
      `[${MARK}].spec.ts`,
    ])
      assert.equal(detail.includes(part), true, part);
    // evidence/ 밖의 증거성 파일은 건드리지 않는다
    assert.deepEqual(readdirSync(r.outDir).sort(), ['evidence', 'local', 'report.json']);
  },
);

posixTest(
  'verifyWeb: 실행기가 evidence 자리에 무언가를 미리 두면 실패하고, 그것을 증거로 내놓지 않는다',
  async () => {
    const planted = fx({ plant: 'file' });
    const r1 = await run(planted);
    assert.equal(r1.ok, false);
    assert.equal(r1.evidence, null);
    assert.match(allProblems(r1), /증거 묶음을 만들지 못했다/);
    // 진단 파일도 마지막 판정과 같다
    const detail = JSON.parse(detailOf(r1)) as { ok: boolean; problems: string[] };
    assert.equal(detail.ok, false);
    assert.match(detail.problems.join('\n'), /증거 묶음을 만들지 못했다/);

    const linked = fx({ plant: 'symlink' });
    const r2 = await run(linked);
    assert.equal(r2.ok, false);
    assert.equal(r2.evidence, null);
    assert.match(allProblems(r2), /증거 묶음을 만들지 못했다/);
    assert.deepEqual(readdirSync(path.join(linked.root, 'outside-evidence')), []);
  },
);

posixTest(
  'verifyWeb: 실행기가 진단 파일 자리를 링크로 바꿔도 그 링크를 따라 쓰지 않는다',
  async () => {
    const f = fx({ swapDetail: true });
    const r = await run(f);
    assert.equal(existsSync(path.join(f.root, 'outside-detail.json')), false);
    assert.deepEqual(evidenceOf(r).files, ['summary.json', 'summary.md']);
  },
);

const WEB = path.join(HARNESS_ROOT, 'scripts/verify/web.ts');

// 구현 판정 F2: 통과로 판정한 뒤 정리하는 동안 중단 신호가 오면 반환값·공개 요약·종료 코드가 모두 실패여야 한다.
// 정리가 시작된 것은 남은 자식이 SIGTERM을 받고 쓰는 파일(got-term)로 안다
posixTest(
  'verifyWeb: 통과 판정 뒤 정리하는 동안 중단 신호가 오면 반환값과 공개 요약이 모두 실패다',
  async () => {
    const f = fx({ leaveStubborn: true });
    const ac = new AbortController();
    const pending = run(f, { signal: ac.signal });
    await waitFor(() => existsSync(path.join(f.root, 'got-term')), 30_000, '정리 시작');
    ac.abort();
    const r = await pending;
    assert.equal(r.ok, false);
    assert.match(allProblems(r), /중단 신호를 받았다/);
    // 시나리오 자신은 통과였다
    assert.equal(r.verdict.scenarios[0].ok, true);
    const e = evidenceOf(r);
    assert.equal(e.summary.ok, false);
    assert.deepEqual(e.summary.problems, [{ category: '중단 신호', count: 1 }]);
    assert.match(e.text, /verify: 실패/);
    assert.equal((JSON.parse(detailOf(r)) as { ok: boolean }).ok, false);
  },
);

posixTest('명령행: 정리하는 동안 SIGTERM을 받으면 종료 코드 1이고 공개 요약도 실패다', async () => {
  const f = fx({ leaveStubborn: true });
  const child = spawn(process.execPath, [WEB], { cwd: f.root, stdio: 'ignore' });
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  await waitFor(() => existsSync(path.join(f.root, 'got-term')), 30_000, '정리 시작');
  child.kill('SIGTERM');
  assert.equal(await exited, 1);
  const base = path.join(f.root, '.harness-verify');
  const runs = readdirSync(base);
  assert.equal(runs.length, 1);
  const summary = JSON.parse(
    readFileSync(path.join(base, runs[0], 'evidence', 'summary.json'), 'utf8'),
  ) as Summary;
  assert.equal(summary.ok, false);
  assert.deepEqual(summary.problems, [{ category: '중단 신호', count: 1 }]);
});

posixTest(
  '명령행: 증거 묶음과 진단 파일의 경로를 내고, 프록시에 닿은 요청이 있으면 종료 코드 1이다',
  () => {
    const ok = fx();
    const r1 = runSync(process.execPath, [WEB], { cwd: ok.root });
    assert.equal(r1.code, 0, r1.stdout + r1.stderr);
    assert.match(
      r1.stdout,
      /증거 묶음\(PR에 올릴 수 있는 요약\): .*\.harness-verify\/[^/]+\/evidence\n/,
    );
    assert.match(
      r1.stdout,
      /진단\(로컬에서만 본다\): .*\.harness-verify\/[^/]+\/local\/detail\.json\n/,
    );

    const denied = fx({ requests: [OUTSIDE] });
    const r2 = runSync(process.execPath, [WEB], { cwd: denied.root });
    assert.equal(r2.code, 1, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /✗ 앱 주소 밖으로 가려는 요청 1건: outside\.example\.test:8080/);
    assert.match(r2.stdout, /verify: 실패/);
    assert.match(r2.stdout, /증거 묶음/);
  },
);
