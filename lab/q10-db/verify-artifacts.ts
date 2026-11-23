// Q10 결과 파일의 출처 확인(계획 20261121-q10-confirm step1). 커밋한 linux-*·win32-* 결과 파일이
// README "잰 머신" 표가 가리키는 CI 실행(main의 q10-trial, workflow_dispatch, 두 OS의 job 성공)의
// 산출물과 값으로 같은지 본다. 내용 검사(check-results.ts)는 값이 맞는지만 보므로, 다른 실행에서
// 받은 파일을 넣고 README에 다른 실행 번호를 적어도 통과한다. 그 틈을 막는다.
//
//   node lab/q10-db/verify-artifacts.ts        리포의 루트에서 돌린다. GitHub은 읽기만 한다
//
// 행마다 한 줄(결과 파일, 실행 번호, 실행의 커밋 앞 12자, 산출물 이름, 같다)을 낸다.
// 문제가 있으면 표준 오류에 내고 종료 코드 1이다. gh나 git을 실행하지 못해도 1이다.
// gh·git은 셸을 거치지 않고 띄운다(macOS·Linux·Windows 네이티브에서 같다).
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { RESULTS_DIR } from './check-results.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..');
const README = path.join(HERE, 'README.md');

export const WORKFLOW_PATH = '.github/workflows/q10-trial.yml';
/** 결과 파일 이름의 앞부분 → 그 파일을 내는 러너(워크플로의 matrix.os) */
export const TARGETS = [
  { prefix: 'linux-', os: 'ubuntu-latest' },
  { prefix: 'win32-', os: 'windows-latest' },
] as const;
export const artifactName = (runner: string): string => `q10-result-${runner}`;

/**
 * 실행 칸이 받는 꼴: 칸 전체(앞뒤 공백 밖)가 이 주소 하나다. 번호 뒤에 글·경로·질의·조각이 붙거나,
 * http·다른 호스트·링크 문법이면 받지 않는다(번호만 떼어 읽으면 적힌 주소와 다른 실행을 확인하게 된다)
 */
const RUN_URL_RE =
  /^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/actions\/runs\/(\d+)$/;
const FILE_RE = /`(?:results\/)?([a-z0-9]+-[a-z0-9_]+\.json)`/;
/** 표의 머리줄에서 찾는 칸의 이름 */
const FILE_COLUMN = '결과 파일';
const RUN_COLUMN = '실행';

export interface Row {
  /** 결과 파일 이름(경로를 뺀 것, 예: linux-x64.json) */
  file: string;
  /** 실행 칸의 글(앞뒤 공백을 뺀 것). 실행 칸이 없으면 빈 글 */
  runCell: string;
  /** 실행 주소의 리포(owner/name). 실행 칸이 주소 꼴이 아니면 null */
  repo: string | null;
  /** 실행 번호. 실행 칸이 주소 꼴이 아니면 null */
  run: number | null;
}

/** 산출물 이름 → (파일 이름 → 글). 받지 못한 산출물은 null */
export type Artifacts = Record<string, Record<string, string> | null>;

export interface RunData {
  /** gh api repos/<리포>/actions/runs/<번호>의 응답 */
  run: unknown;
  /** gh api repos/<리포>/actions/runs/<번호>/jobs의 응답 */
  jobs: unknown;
  /** 실행의 커밋(head_sha)이 origin/main의 조상인가. 커밋을 몰라 확인하지 못했으면 null */
  ancestor: boolean | null;
  artifacts: Artifacts;
}

export interface ProvenanceInput {
  /** 이 리포(owner/name) */
  repo: string;
  /** README "잰 머신" 표의 행 */
  rows: Row[];
  /** results/의 결과 파일 이름 → 커밋된 글 */
  resultFiles: Record<string, string>;
  /** 실행 번호 → 모은 자료 */
  runs: Record<number, RunData>;
}

type Json = Record<string, unknown>;
const isObj = (x: unknown): x is Json => !!x && typeof x === 'object' && !Array.isArray(x);
const show = (v: unknown): string =>
  typeof v === 'string' ? v : (JSON.stringify(v) ?? 'undefined');
const targetOf = (file: string) => TARGETS.find((t) => file.startsWith(t.prefix));

/** `## <제목>`부터 다음 `## ` 앞까지의 줄. 줄 끝(CRLF)은 뺀다 */
function sectionLines(doc: string, heading: string): string[] {
  const lines = doc.split(/\r?\n/);
  const start = lines.findIndex((l) => l === `## ${heading}`);
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## '));
  return end < 0 ? rest : rest.slice(0, end);
}

/** 표의 한 줄을 칸으로 나눈다(앞뒤의 `|`를 떼고, 칸마다 앞뒤 공백을 뺀다) */
export function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());
}

/**
 * README "잰 머신" 표의 행을 읽는다. 첫 표의 머리줄에서 "결과 파일"·"실행" 칸을 찾고,
 * 결과 파일 칸에 이름을 백틱으로 적은 행만 낸다. 실행 칸 전체가 주소 꼴일 때만 리포와 번호를 읽는다
 */
export function readRows(readme: string): Row[] {
  const table = sectionLines(readme, '잰 머신').filter((l) => l.trim().startsWith('|'));
  if (!table.length) return [];
  const head = tableCells(table[0]);
  const fileAt = head.indexOf(FILE_COLUMN);
  const runAt = head.indexOf(RUN_COLUMN);
  if (fileAt < 0) return [];
  const rows: Row[] = [];
  for (const line of table.slice(1)) {
    const c = tableCells(line);
    if (c.every((x) => /^:?-+:?$/.test(x))) continue; // 구분 줄
    const f = FILE_RE.exec(c[fileAt] ?? '');
    if (!f) continue;
    const runCell = runAt < 0 ? '' : (c[runAt] ?? '');
    const u = RUN_URL_RE.exec(runCell);
    rows.push({ file: f[1], runCell, repo: u ? u[1] : null, run: u ? Number(u[2]) : null });
  }
  return rows;
}

/** 글을 JSON으로 읽는다. 읽지 못하면 undefined(JSON에는 undefined가 없다) */
function parse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** 한 실행의 응답(실행, job, 조상 여부)에서 문제를 찾는다 */
function runProblems(n: number, data: RunData | undefined): string[] {
  if (!data) return [`실행 ${n}의 정보가 없다`];
  const out: string[] = [];
  const r = data.run;
  if (!isObj(r)) out.push(`실행 ${n}: 실행 정보가 객체가 아니다: ${show(r)}`);
  else {
    if (r.path !== WORKFLOW_PATH)
      out.push(`실행 ${n}: 워크플로가 ${WORKFLOW_PATH}이 아니다: ${show(r.path)}`);
    if (r.event !== 'workflow_dispatch')
      out.push(`실행 ${n}: 이벤트가 workflow_dispatch가 아니다: ${show(r.event)}`);
    if (r.head_branch !== 'main')
      out.push(`실행 ${n}: 브랜치가 main이 아니다: ${show(r.head_branch)}`);
    if (r.status !== 'completed') out.push(`실행 ${n}: 끝나지 않았다(status ${show(r.status)})`);
    if (r.conclusion !== 'success')
      out.push(`실행 ${n}: 성공하지 않았다(conclusion ${show(r.conclusion)})`);
    if (typeof r.head_sha !== 'string' || !/^[0-9a-f]{40}$/.test(r.head_sha))
      out.push(`실행 ${n}: 커밋(head_sha)이 없다: ${show(r.head_sha)}`);
    else if (data.ancestor !== true)
      out.push(
        `실행 ${n}: 커밋 ${r.head_sha.slice(0, 12)}가 origin/main의 조상이 아니다` +
          (data.ancestor === null ? '(확인하지 못했다)' : ''),
      );
  }
  const jobs = isObj(data.jobs) && Array.isArray(data.jobs.jobs) ? data.jobs.jobs : null;
  if (!jobs) out.push(`실행 ${n}: job 목록을 읽지 못했다: ${show(data.jobs)}`);
  else
    for (const t of TARGETS) {
      const mine = jobs.filter(
        (j) => isObj(j) && typeof j.name === 'string' && j.name.includes(t.os),
      );
      if (!mine.length) out.push(`실행 ${n}: ${t.os} job이 없다`);
      for (const j of mine)
        if (!isObj(j) || j.conclusion !== 'success')
          out.push(
            `실행 ${n}: ${t.os} job이 성공하지 않았다(conclusion ${show(isObj(j) ? j.conclusion : j)})`,
          );
    }
  return out;
}

/** 한 행의 결과 파일을 그 실행의 산출물과 견준다 */
function fileProblems(row: Row, run: number, input: ProvenanceInput): string[] {
  const target = targetOf(row.file);
  if (!target) return [];
  const name = artifactName(target.os);
  const data = input.runs[run];
  if (!data) return []; // runProblems가 낸다
  const files = data.artifacts[name];
  if (!files) return [`실행 ${run}: 산출물 ${name}을 받지 못했다`];
  const committed = input.resultFiles[row.file];
  if (committed === undefined) return [`${row.file}: 행은 있는데 결과 파일이 없다`];
  const fromArtifact = files[row.file];
  if (fromArtifact === undefined) {
    const others = TARGETS.filter((t) => t.os !== target.os)
      .map((t) => artifactName(t.os))
      .filter((a) => data.artifacts[a]?.[row.file] !== undefined);
    return [
      others.length
        ? `${row.file}: 산출물 ${name}에 없고 다른 OS의 산출물(${others.join(', ')})에만 있다`
        : `${row.file}: 산출물 ${name}에 그 파일이 없다`,
    ];
  }
  const a = parse(committed);
  const b = parse(fromArtifact);
  const out: string[] = [];
  if (a === undefined) out.push(`${row.file}: 커밋한 파일을 JSON으로 읽을 수 없다`);
  if (b === undefined) out.push(`${row.file}: 산출물의 파일을 JSON으로 읽을 수 없다`);
  if (!out.length && !isDeepStrictEqual(a, b))
    out.push(`${row.file}: 커밋한 파일과 산출물의 값이 다르다(산출물 ${name}, 실행 ${run})`);
  return out;
}

/** 모은 자료에서 문제의 목록을 낸다. 빈 배열이면 출처가 확인된 것이다 */
export function provenanceProblems(input: ProvenanceInput): string[] {
  const out: string[] = [];
  const targets = input.rows.filter((r) => targetOf(r.file));
  for (const t of TARGETS)
    if (!targets.some((r) => r.file.startsWith(t.prefix)))
      out.push(`잰 머신 표에 ${t.prefix} 결과 파일의 행이 없다`);
  for (const f of Object.keys(input.resultFiles).sort())
    if (targetOf(f) && !targets.some((r) => r.file === f))
      out.push(`${f}: 결과 파일은 있는데 잰 머신 표에 행이 없다`);

  const runs = new Set<number>();
  for (const row of targets) {
    if (row.run === null || row.repo === null) {
      out.push(
        row.runCell === ''
          ? `${row.file}: 행에 실행 주소가 없다(실행 칸이 비었다)`
          : `${row.file}: 실행 칸이 실행 주소의 꼴이 아니다(https://github.com/<owner>/<repo>/actions/runs/<번호> 하나만 받는다): ${row.runCell}`,
      );
      continue;
    }
    if (row.repo.toLowerCase() !== input.repo.toLowerCase()) {
      out.push(`${row.file}: 실행 주소의 리포(${row.repo})가 이 리포(${input.repo})가 아니다`);
      continue;
    }
    runs.add(row.run);
    out.push(...fileProblems(row, row.run, input));
  }
  for (const n of [...runs].sort((a, b) => a - b)) out.push(...runProblems(n, input.runs[n]));
  return out;
}

/** 행마다 한 줄: 결과 파일, 실행 번호, 실행의 커밋 앞 12자, 산출물 이름, 같다(문제가 없을 때 낸다) */
export function summaryLines(input: ProvenanceInput): string[] {
  return input.rows.flatMap((row) => {
    const target = targetOf(row.file);
    if (!target || row.run === null) return [];
    const r = input.runs[row.run]?.run;
    const sha = isObj(r) && typeof r.head_sha === 'string' ? r.head_sha.slice(0, 12) : '?';
    return [
      `results/${row.file} · 실행 ${row.run} · 커밋 ${sha} · 산출물 ${artifactName(target.os)} · 같다`,
    ];
  });
}

export interface ExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** 실행하지 못했으면 그 이유 */
  error?: string;
}
export type Exec = (cmd: 'gh' | 'git', args: string[]) => ExecResult;

/** gh·git을 셸 없이 리포의 루트에서 띄운다 */
export const realExec: Exec = (cmd, args) => {
  const r = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return {
    status: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    ...(r.error ? { error: r.error.message } : {}),
  };
};

/** 실행하지 못했거나 0이 아닌 종료 코드면 예외 */
function run(exec: Exec, cmd: 'gh' | 'git', args: string[]): string {
  const r = exec(cmd, args);
  if (r.error || r.status !== 0)
    throw new Error(
      `${cmd} ${args.join(' ')}을 실행하지 못했다: ${r.error ?? `종료 코드 ${r.status}`} ${r.stderr.trim()}`.trim(),
    );
  return r.stdout;
}

function json(exec: Exec, args: string[]): unknown {
  const out = run(exec, 'gh', args);
  try {
    return JSON.parse(out) as unknown;
  } catch {
    throw new Error(`gh ${args.join(' ')}의 출력을 JSON으로 읽지 못했다`);
  }
}

/** 받은 산출물 폴더의 파일(하위 폴더는 보지 않는다) */
function readDir(dir: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isFile()) files[f] = readFileSync(p, 'utf8');
  }
  return files;
}

/**
 * gh·git으로 자료를 모은다. GitHub은 읽기만 한다(gh api의 조회, gh run download).
 * 산출물은 실행·산출물마다 새 임시 폴더(mkdtempSync)에 받고 지우지 않는다.
 */
export function collect(opts: {
  readme: string;
  resultFiles: Record<string, string>;
  exec: Exec;
}): ProvenanceInput {
  const { exec } = opts;
  const repo = run(exec, 'gh', [
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]).trim();
  const rows = readRows(opts.readme);
  const runs: Record<number, RunData> = {};
  for (const row of rows) {
    if (!targetOf(row.file) || row.run === null || row.repo === null) continue;
    if (row.repo.toLowerCase() !== repo.toLowerCase() || runs[row.run]) continue;
    const n = row.run;
    const info = json(exec, ['api', `repos/${repo}/actions/runs/${n}`]);
    const jobs = json(exec, ['api', `repos/${repo}/actions/runs/${n}/jobs`]);
    let ancestor: boolean | null = null;
    if (isObj(info) && typeof info.head_sha === 'string' && /^[0-9a-f]{40}$/.test(info.head_sha)) {
      const r = exec('git', ['merge-base', '--is-ancestor', info.head_sha, 'origin/main']);
      if (r.error || (r.status !== 0 && r.status !== 1))
        throw new Error(
          `git merge-base --is-ancestor를 실행하지 못했다: ${r.error ?? `종료 코드 ${r.status}`} ${r.stderr.trim()}`.trim(),
        );
      ancestor = r.status === 0;
    }
    const artifacts: Artifacts = {};
    for (const t of TARGETS) {
      const name = artifactName(t.os);
      const dir = mkdtempSync(path.join(os.tmpdir(), 'q10-verify-'));
      const r = exec('gh', ['run', 'download', String(n), '--name', name, '--dir', dir]);
      if (r.error) throw new Error(`gh run download를 실행하지 못했다: ${r.error}`);
      artifacts[name] = r.status === 0 ? readDir(dir) : null;
    }
    runs[n] = { run: info, jobs, ancestor, artifacts };
  }
  return { repo, rows, resultFiles: opts.resultFiles, runs };
}

/** results/의 결과 파일(.json) 이름 → 글 */
function readResultFiles(): Record<string, string> {
  if (!existsSync(RESULTS_DIR)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(RESULTS_DIR).sort())
    if (f.endsWith('.json')) out[f] = readFileSync(path.join(RESULTS_DIR, f), 'utf8');
  return out;
}

function main(argv: string[]): number {
  if (argv.length) {
    process.stderr.write('사용법: node lab/q10-db/verify-artifacts.ts\n');
    return 2;
  }
  let input: ProvenanceInput;
  try {
    input = collect({
      readme: readFileSync(README, 'utf8'),
      resultFiles: readResultFiles(),
      exec: realExec,
    });
  } catch (e) {
    process.stderr.write(`verify-artifacts: ${e instanceof Error ? e.message : String(e)}\n`);
    return 1;
  }
  const problems = provenanceProblems(input);
  if (problems.length) {
    process.stderr.write(`verify-artifacts: 출처를 확인하지 못했다(${problems.length}건)\n`);
    for (const p of problems) process.stderr.write(`- ${p}\n`);
    return 1;
  }
  for (const l of summaryLines(input)) process.stdout.write(`${l}\n`);
  return 0;
}

/**
 * 이 파일을 직접 실행했는가. 두 경로를 실제 경로로 풀어 견준다: 링크를 거친 경로(macOS의 /var → /private/var,
 * Windows의 정션)로 실행하면 실행 경로와 import.meta.url이 달라, 그대로 견주면 아무것도 하지 않고 0으로 끝난다
 */
function isMain(): boolean {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return (
      realpathSync.native(path.resolve(arg)) === realpathSync.native(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = main(process.argv.slice(2));
