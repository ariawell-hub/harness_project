// verify-artifacts.ts 테스트: 커밋한 결과 파일이 README가 가리키는 실행의 산출물인지 본다.
// 네트워크를 쓰지 않는다(gh·git은 가짜 exec로 바꾼다).
//   node --test lab/q10-db/test/verify-artifacts.test.ts
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  artifactName,
  collect,
  type Exec,
  type ProvenanceInput,
  provenanceProblems,
  readRows,
  summaryLines,
  WORKFLOW_PATH,
} from '../verify-artifacts.ts';

const REPO = 'owner/repo';
const RUN = 101;
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const URL = (repo: string, run: number) => `https://github.com/${repo}/actions/runs/${run}`;

/** 결과 파일의 값(짧게). 실제 파일과 키 이름이 같을 필요는 없다: 비교는 값 전체를 본다 */
const DARWIN = { platform: 'darwin', arch: 'arm64', pnpm: '10.34.5', cases: [{ rows: 1 }] };
const LINUX = {
  platform: 'linux',
  arch: 'x64',
  pnpm: '10.34.5',
  cases: [{ rows: 1 }, { rows: 2 }],
};
const WIN = { platform: 'win32', arch: 'x64', pnpm: '10.34.5', cases: [{ rows: 1 }, { rows: 2 }] };

/** 리포에 커밋한 꼴(포매터가 다듬은 꼴: 들여쓰기 2, 끝에 줄바꿈) */
const pretty = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;
/** 산출물의 꼴(trial.ts가 쓴 그대로라고 치고 일부러 다르게: 한 줄, 끝에 줄바꿈 없음) */
const compact = (v: unknown) => JSON.stringify(v);

function readme(rows: string[]): string {
  return [
    '# Q10',
    '',
    '## 잰 머신',
    '',
    '| 결과 파일 | 머신 | 날짜 | 실행 |',
    '| --- | --- | --- | --- |',
    ...rows,
    '',
    '## 확정 조건',
    '',
    '| `results/linux-x9.json` | 이 표는 잰 머신 표가 아니다 | | |',
    '',
  ].join('\n');
}

const DARWIN_ROW = '| `results/darwin-arm64.json` | macOS(Apple Silicon) | 2026-11-20 | |';
const linuxRow = (url = URL(REPO, RUN)) =>
  `| \`results/linux-x64.json\` | GitHub Actions \`ubuntu-latest\` | 2026-11-23 | ${url} |`;
const winRow = (url = URL(REPO, RUN)) =>
  `| \`results/win32-x64.json\` | GitHub Actions \`windows-latest\` | 2026-11-23 | ${url} |`;

function good(): ProvenanceInput {
  return {
    repo: REPO,
    rows: readRows(readme([DARWIN_ROW, linuxRow(), winRow()])),
    resultFiles: {
      'darwin-arm64.json': pretty(DARWIN),
      'linux-x64.json': pretty(LINUX),
      'win32-x64.json': pretty(WIN),
    },
    runs: {
      [RUN]: {
        run: {
          path: WORKFLOW_PATH,
          event: 'workflow_dispatch',
          head_branch: 'main',
          status: 'completed',
          conclusion: 'success',
          head_sha: SHA,
        },
        jobs: {
          total_count: 2,
          jobs: [
            { name: 'trial (ubuntu-latest)', status: 'completed', conclusion: 'success' },
            { name: 'trial (windows-latest)', status: 'completed', conclusion: 'success' },
          ],
        },
        ancestor: true,
        artifacts: {
          [artifactName('ubuntu-latest')]: {
            'darwin-arm64.json': compact(DARWIN),
            'linux-x64.json': compact(LINUX),
          },
          [artifactName('windows-latest')]: {
            'darwin-arm64.json': compact(DARWIN),
            'win32-x64.json': compact(WIN),
          },
        },
      },
    },
  };
}

type Run = ProvenanceInput['runs'][number];
const runOf = (i: ProvenanceInput): Run => i.runs[RUN];
const runInfo = (i: ProvenanceInput) => runOf(i).run as Record<string, unknown>;
const jobsOf = (i: ProvenanceInput) => (runOf(i).jobs as { jobs: Record<string, unknown>[] }).jobs;
const art = (i: ProvenanceInput, os: string) =>
  runOf(i).artifacts[artifactName(os)] as Record<string, string>;

/** 문제가 하나 이상이고 그 가운데 pattern에 맞는 것이 있다 */
function assertProblem(input: ProvenanceInput, pattern: RegExp): void {
  const problems = provenanceProblems(input);
  assert.ok(
    problems.some((p) => pattern.test(p)),
    `${pattern}에 맞는 문제가 없다: ${JSON.stringify(problems)}`,
  );
}

test('readRows: 잰 머신 표의 행만 읽고, 파일 이름·리포·실행 번호를 꺼낸다', () => {
  const rows = readRows(readme([DARWIN_ROW, linuxRow(), winRow(URL('other/repo', 7))]));
  assert.deepEqual(
    rows.map(({ file, repo, run }) => ({ file, repo, run })),
    [
      { file: 'darwin-arm64.json', repo: null, run: null },
      { file: 'linux-x64.json', repo: REPO, run: RUN },
      { file: 'win32-x64.json', repo: 'other/repo', run: 7 },
    ],
  );
});

test('readRows: CRLF 줄 끝에서도 같다', () => {
  const lf = readme([DARWIN_ROW, linuxRow(), winRow()]);
  assert.deepEqual(readRows(lf.replace(/\n/g, '\r\n')), readRows(lf));
});

test('readRows: 표가 없으면 빈 목록', () => {
  assert.deepEqual(readRows('# 제목\n\n## 잰 머신\n\n없다\n'), []);
  assert.deepEqual(readRows(''), []);
});

test('모두 맞으면 문제가 0건이고, 행마다 요약 한 줄을 낸다', () => {
  const input = good();
  assert.deepEqual(provenanceProblems(input), []);
  assert.deepEqual(summaryLines(input), [
    `results/linux-x64.json · 실행 ${RUN} · 커밋 ${SHA.slice(0, 12)} · 산출물 q10-result-ubuntu-latest · 같다`,
    `results/win32-x64.json · 실행 ${RUN} · 커밋 ${SHA.slice(0, 12)} · 산출물 q10-result-windows-latest · 같다`,
  ]);
});

test('포맷만 다른 파일(들여쓰기, CRLF 줄 끝, 끝의 줄바꿈)은 문제가 아니다', () => {
  const input = good();
  input.resultFiles['linux-x64.json'] = `${JSON.stringify(LINUX, null, 4)}`;
  input.resultFiles['win32-x64.json'] = pretty(WIN).replace(/\n/g, '\r\n');
  art(input, 'ubuntu-latest')['linux-x64.json'] = `${pretty(LINUX)}\n\n`;
  assert.deepEqual(provenanceProblems(input), []);
});

test('다른 워크플로의 실행은 문제다', () => {
  const input = good();
  runInfo(input).path = '.github/workflows/check.yml';
  assertProblem(input, /워크플로가 \.github\/workflows\/q10-trial\.yml이 아니다/);
});

test('main이 아닌 브랜치의 실행은 문제다', () => {
  const input = good();
  runInfo(input).head_branch = 'feature';
  assertProblem(input, /브랜치가 main이 아니다: feature/);
});

test('workflow_dispatch가 아닌 이벤트는 문제다', () => {
  const input = good();
  runInfo(input).event = 'push';
  assertProblem(input, /이벤트가 workflow_dispatch가 아니다: push/);
});

test('끝나지 않은 실행은 문제다', () => {
  const input = good();
  runInfo(input).status = 'in_progress';
  assertProblem(input, /끝나지 않았다/);
});

test('실패한 실행은 문제다', () => {
  const input = good();
  runInfo(input).conclusion = 'failure';
  assertProblem(input, /성공하지 않았다\(conclusion failure\)/);
});

test('origin/main의 조상이 아닌 커밋의 실행은 문제다', () => {
  const input = good();
  runOf(input).ancestor = false;
  assertProblem(input, /origin\/main의 조상이 아니다/);
});

test('한 OS의 job이 없으면 문제다', () => {
  const input = good();
  (runOf(input).jobs as { jobs: unknown[] }).jobs = [jobsOf(input)[0]];
  assertProblem(input, /windows-latest job이 없다/);
});

test('한 OS의 job이 실패했으면 문제다', () => {
  const input = good();
  jobsOf(input)[0].conclusion = 'failure';
  assertProblem(input, /ubuntu-latest job이 성공하지 않았다/);
});

test('실행 주소의 리포가 이 리포가 아니면 문제다', () => {
  const input = good();
  input.rows = readRows(readme([DARWIN_ROW, linuxRow(URL('fork/repo', RUN)), winRow()]));
  assertProblem(
    input,
    /linux-x64\.json: 실행 주소의 리포\(fork\/repo\)가 이 리포\(owner\/repo\)가 아니다/,
  );
});

test('행에 실행 주소가 없으면 문제다', () => {
  const input = good();
  input.rows = readRows(readme([DARWIN_ROW, linuxRow(''), winRow()]));
  assertProblem(input, /linux-x64\.json: 행에 실행 주소가 없다/);
});

test('linux-나 win32- 행이 없으면 문제다', () => {
  const noWin = good();
  noWin.rows = readRows(readme([DARWIN_ROW, linuxRow()]));
  delete noWin.resultFiles['win32-x64.json'];
  assertProblem(noWin, /win32- 결과 파일의 행이 없다/);
  const noLinux = good();
  noLinux.rows = readRows(readme([DARWIN_ROW, winRow()]));
  delete noLinux.resultFiles['linux-x64.json'];
  assertProblem(noLinux, /linux- 결과 파일의 행이 없다/);
});

test('결과 파일은 있는데 행이 없으면 문제다', () => {
  const input = good();
  input.resultFiles['linux-arm64.json'] = pretty({ ...LINUX, arch: 'arm64' });
  assertProblem(input, /linux-arm64\.json: 결과 파일은 있는데 잰 머신 표에 행이 없다/);
});

test('행은 있는데 결과 파일이 없으면 문제다', () => {
  const input = good();
  delete input.resultFiles['win32-x64.json'];
  assertProblem(input, /win32-x64\.json: 행은 있는데 결과 파일이 없다/);
});

test('산출물에 그 파일이 없으면 문제다', () => {
  const input = good();
  delete art(input, 'ubuntu-latest')['linux-x64.json'];
  assertProblem(input, /linux-x64\.json: 산출물 q10-result-ubuntu-latest에 그 파일이 없다/);
});

test('다른 OS의 산출물에만 파일이 있으면 일치로 치지 않는다', () => {
  const input = good();
  delete art(input, 'ubuntu-latest')['linux-x64.json'];
  art(input, 'windows-latest')['linux-x64.json'] = compact(LINUX);
  assertProblem(input, /linux-x64\.json: .*다른 OS의 산출물\(q10-result-windows-latest\)에만 있다/);
});

test('산출물을 받지 못했으면 문제다', () => {
  const input = good();
  runOf(input).artifacts[artifactName('windows-latest')] = null;
  assertProblem(input, /산출물 q10-result-windows-latest을 받지 못했다/);
});

test('값이 하나라도 다르면 문제다(숫자와 글, 배열의 순서 포함)', () => {
  const cases: unknown[] = [
    { ...LINUX, pnpm: '10.34.6' },
    { ...LINUX, cases: [{ rows: '1' }, { rows: 2 }] },
    { ...LINUX, cases: [{ rows: 2 }, { rows: 1 }] },
    { ...LINUX, extra: true },
  ];
  for (const changed of cases) {
    const input = good();
    art(input, 'ubuntu-latest')['linux-x64.json'] = compact(changed);
    assertProblem(input, /linux-x64\.json: 커밋한 파일과 산출물의 값이 다르다/);
  }
});

test('JSON으로 읽을 수 없으면 문제다(커밋한 파일, 산출물)', () => {
  const committed = good();
  committed.resultFiles['linux-x64.json'] = '{ "platform": ';
  assertProblem(committed, /linux-x64\.json: 커밋한 파일을 JSON으로 읽을 수 없다/);
  const artifact = good();
  art(artifact, 'windows-latest')['win32-x64.json'] = 'not json';
  assertProblem(artifact, /win32-x64\.json: 산출물의 파일을 JSON으로 읽을 수 없다/);
});

test('실행 정보를 읽지 못했으면 문제다', () => {
  const input = good();
  input.runs = {};
  assertProblem(input, /실행 101의 정보가 없다/);
  const bad = good();
  runOf(bad).run = 'not an object';
  assertProblem(bad, /실행 101: 실행 정보가 객체가 아니다/);
});

/** gh·git 호출을 흉내 낸다. 받은 인자를 기록하고, run download는 --dir 폴더에 산출물 파일을 쓴다 */
function fakeExec(
  input: ProvenanceInput,
  opts: { failDownload?: string; ancestor?: boolean } = {},
): { exec: Exec; calls: string[][] } {
  const calls: string[][] = [];
  const exec: Exec = (cmd, args) => {
    calls.push([cmd, ...args]);
    const ok = (stdout: string) => ({ status: 0, stdout, stderr: '' });
    if (cmd === 'gh' && args[0] === 'repo') return ok(`${REPO}\n`);
    if (cmd === 'gh' && args[0] === 'api') {
      const m = /^repos\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)(\/jobs)?$/.exec(args[1] ?? '');
      if (!m) return { status: 1, stdout: '', stderr: 'unknown api' };
      const run = input.runs[Number(m[2])];
      return ok(JSON.stringify(m[3] ? run.jobs : run.run));
    }
    if (cmd === 'git' && args[0] === 'merge-base')
      return { status: opts.ancestor === false ? 1 : 0, stdout: '', stderr: '' };
    if (cmd === 'gh' && args[0] === 'run' && args[1] === 'download') {
      const name = args[args.indexOf('--name') + 1];
      const dir = args[args.indexOf('--dir') + 1];
      if (name === opts.failDownload) return { status: 1, stdout: '', stderr: 'no artifact' };
      const files = input.runs[Number(args[2])].artifacts[name] ?? {};
      mkdirSync(dir, { recursive: true });
      for (const [f, text] of Object.entries(files)) writeFileSync(path.join(dir, f), text);
      return ok('');
    }
    return { status: 1, stdout: '', stderr: `unexpected ${cmd} ${args.join(' ')}` };
  };
  return { exec, calls };
}

test('collect: gh·git에서 모은 자료가 good()과 같은 판정을 낸다(조회만 한다)', () => {
  const input = good();
  const { exec, calls } = fakeExec(input);
  const got = collect({
    readme: readme([DARWIN_ROW, linuxRow(), winRow()]),
    resultFiles: input.resultFiles,
    exec,
  });
  assert.deepEqual(provenanceProblems(got), []);
  assert.deepEqual(got.runs[RUN].artifacts, input.runs[RUN].artifacts);
  assert.equal(got.runs[RUN].ancestor, true);
  // 쓰는 명령은 조회와 산출물 받기뿐이다
  for (const c of calls) {
    const head = c.slice(0, 2).join(' ');
    assert.ok(
      ['gh repo', 'gh api', 'gh run', 'git merge-base'].includes(head),
      `예상하지 못한 호출: ${c.join(' ')}`,
    );
    if (head === 'gh api') assert.equal(c.length, 3, 'gh api에는 경로만 넘긴다(-X·-f 없음)');
  }
  assert.ok(
    calls.some((c) => c.join(' ').startsWith(`git merge-base --is-ancestor ${SHA} origin/main`)),
  );
});

test('collect: 조상이 아니면(종료 코드 1) false, 산출물을 받지 못하면 null', () => {
  const input = good();
  const { exec } = fakeExec(input, {
    ancestor: false,
    failDownload: artifactName('windows-latest'),
  });
  const got = collect({
    readme: readme([DARWIN_ROW, linuxRow(), winRow()]),
    resultFiles: input.resultFiles,
    exec,
  });
  assert.equal(got.runs[RUN].ancestor, false);
  assert.equal(got.runs[RUN].artifacts[artifactName('windows-latest')], null);
  const problems = provenanceProblems(got);
  assert.ok(problems.some((p) => /origin\/main의 조상이 아니다/.test(p)));
  assert.ok(problems.some((p) => /q10-result-windows-latest을 받지 못했다/.test(p)));
});

test('collect: gh를 실행하지 못하면 예외를 낸다(명령은 종료 코드 1)', () => {
  const exec: Exec = () => ({ status: null, stdout: '', stderr: '', error: 'spawn gh ENOENT' });
  assert.throws(
    () => collect({ readme: readme([linuxRow(), winRow()]), resultFiles: {}, exec }),
    /gh.*ENOENT/,
  );
});
