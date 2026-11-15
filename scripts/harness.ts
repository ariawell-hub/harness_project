// 하네스 CLI 진입점. 정규 호출: node scripts/harness.ts <명령> [옵션]
// 모든 명령은 비대화식이고, 종료 코드로 성공·실패를 알린다(6절).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { STANDARD_COMMANDS, loadConfig, type StandardName } from './lib/config.ts';
import { changedFiles, defaultBase, git, repoInfo } from './lib/git.ts';
import { formatProblem, log } from './lib/util.ts';
import { runGates, summaryMarkdown } from './ci/gates.ts';
import {
  carryOver,
  changedOnBaseSince,
  fetchCandidates,
  patchId,
  samePrContent,
} from './ci/binding.ts';
import { scanClaudeRun } from './ci/claude-scan.ts';
import {
  diffAuth,
  restoreAuth,
  sealAuth,
  snapshotAuth,
  writeCodexConfig,
  type AuthSnapshot,
} from './ci/codex-auth.ts';
import { authTokenValues, codexOutputSchema, scanCodexRun } from './ci/codex-scan.ts';
import { githubGet, resolvePr } from './ci/pr.ts';
import { compareRequiredChecks, toRequiredChecks } from './ci/protection.ts';
import { parseReviews } from './gates/risk-gate.ts';
import { githubStatusPoster, oneLine, recordReview, recordStatuses } from './ci/record.ts';
import { writeReviewInput } from './ci/review-input.ts';
import { planReview } from './ci/review-plan.ts';
import { CHECK_STEPS, runCheck, type CheckStep } from './commands/check.ts';
import { init } from './commands/init.ts';
import { describeFailure, runStandard } from './commands/standard.ts';
import { describeExcluded, describeTask, start } from './commands/start.ts';
import { TaskError, claimHeartbeat, completeStep, newTask } from './commands/task.ts';
import { bypassScan } from './gates/bypass-scan.ts';
import { docLint, printDocLint } from './gates/doc-lint.ts';
import { planGate } from './gates/plan-gate.ts';
import { secretScan } from './gates/secret-scan.ts';
import { getGitHub } from './lib/github.ts';
import { pickNext } from './runner/next.ts';
import { runRunner } from './runner/run.ts';

const HELP = `하네스 명령 (node scripts/harness.ts <명령>)

표준 명령(6절): setup | fmt [--check] | lint | test | build | dev | verify | check
  check [--ci] [--no-cache] [--base <sha>] [--only fmt,lint,...]

작업:
  start [--worker <이름>]                 세션 시작 절차(needs-human → 정리 → 다음 할 일)
  next [--worker <이름>] [--json]          다음 할 일만 출력
  new-task --issue <N> --slug <이름> [--type feat] [--size small|medium|large] [--risk low|normal|high]
           [--owner <이름>] [--title <제목>] [--no-claim] [--no-setup] [--no-github]
  new-task --plan <계획 id> --step <N>     다음 step의 브랜치·worktree
  complete-step                            계획 전용 커밋(현재 worktree의 step 완료 처리)
  claim-heartbeat --issue <N>              선점 생존 확인
  run [--worker runner-1] [--tool claude|codex] [--once] [--max-iterations N]   runner

게이트:
  plan-gate [--repo <dir>] [--config-root <dir>] [--base <sha>] [--head-ref <브랜치>] [--mode pr|plan]
  doc-lint | bypass-scan [--ci] [--base <sha>] | secret-scan [--ci] [--base <sha>]

CI(gates 워크플로, 10.4절):
  ci-pr --event <이벤트 JSON> --body-out <파일>
                                           판정할 PR을 정해 $GITHUB_OUTPUT에 쓴다(이벤트 이름·리포·토큰은 환경 변수)
  gates --repo <pr> --config-root <base> --base <sha> --head-ref <브랜치> --out <파일> [--summary <파일>]
        [--reviews <리뷰 API JSON>] [--pr-body <본문 파일>]   기계 판정 결과 파일(판정 job, 비밀 없음)
  record-status --results <파일> --head-sha <sha> --repo-slug <owner/name> --target-url <url>
                                           결과 검사 뒤 커밋 상태 기록(기록 job, 토큰은 GH_TOKEN)

  record-review --context <review/claude|review/codex> --needed <true|false> --verdict <파일>
                --head-sha <sha> --repo-slug <owner/name> --target-url <url> [--patch <id>] [--carried-from <sha>]
                                           검증자 판정 검사 뒤 review/* 기록(스캔할 비밀은 SCAN_SECRETS에 줄 단위)
  review-plan --repo <pr> --config-root <base> --base <sha> --head-ref <브랜치> [--pr-number <N> --base-sha <sha>]
                                           위험도와 필요한 검증자를 $GITHUB_OUTPUT에 쓰고 검증 입력(pr/.harness-review/)을 만든다
                                           PR 번호를 주면 승인 이어받기(patch, carry_claude, carry_codex)도 판정한다(10.3절)
  claude-scan --log <stream-json> --pr <pr 폴더> --out <verdict.json>
                                           Claude 실행 기록 유출 검사. 문제가 없을 때만 판정을 쓴다(비밀은 SCAN_SECRETS)
  codex-auth restore --home <CODEX_HOME>   시크릿(CODEX_AUTH_JSON) → auth.json(0600). 값은 출력하지 않는다
  codex-auth snapshot --auth <auth.json> --out <파일> | diff --snap <파일> --auth <auth.json>
  codex-auth config --home <CODEX_HOME> --pr <pr 폴더> --deny <폴더:폴더:…>   판정용 config.toml(권한 프로필)
  codex-auth seal --auth <auth.json> --sodium-dir <폴더>   공개키(PUBKEY)로 봉인해 $GITHUB_OUTPUT에 sealed=
  codex-schema --out <파일>                 codex exec --output-schema용 스키마
  codex-scan --events <jsonl> --last <파일> --stderr <파일> --pr <pr 폴더> --auth <auth.json> --out <verdict.json>
                                           Codex 실행 기록 유출 검사(실행 전 시크릿은 SCAN_AUTH_JSON)
  required-checks                          main 필수 체크의 등록·출처를 설정(ci.requiredChecks)과 비교(읽기만)

설정:
  init --profile core|web [--owner <제작자 계정>] [--bot <봇 계정>]
`;

type OptionKind = 'string' | 'boolean';

/**
 * `--` 앞 인자를 훑어 도움말 요청과 모르는 옵션을 찾는다(TD-17).
 * parseArgs가 strict: false라 모르는 플래그를 조용히 무시해서, `run --help`가 runner를 실제로 시작했다.
 * 문자열 옵션의 값 자리(`--title -h`)는 건너뛴다.
 */
function scanArgs(
  args: string[],
  options: Record<string, { type: OptionKind }>,
): { help: boolean; unknown: string[] } {
  const unknown: string[] = [];
  let help = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      help = true;
      continue;
    }
    if (!a.startsWith('--') || a === '--') continue;
    const name = a.slice(2).split('=')[0];
    const def = options[name];
    if (!def) unknown.push(`--${name}`);
    else if (def.type === 'string' && !a.includes('=')) i++;
  }
  return { help, unknown };
}

const OPTIONS: Record<string, { type: OptionKind }> = {
  check: { type: 'boolean' },
  ci: { type: 'boolean' },
  'no-cache': { type: 'boolean' },
  base: { type: 'string' },
  only: { type: 'string' },
  repo: { type: 'string' },
  'config-root': { type: 'string' },
  'head-ref': { type: 'string' },
  'head-sha': { type: 'string' },
  out: { type: 'string' },
  summary: { type: 'string' },
  results: { type: 'string' },
  context: { type: 'string' },
  needed: { type: 'string' },
  verdict: { type: 'string' },
  reviews: { type: 'string' },
  'pr-body': { type: 'string' },
  event: { type: 'string' },
  'body-out': { type: 'string' },
  log: { type: 'string' },
  'pr-number': { type: 'string' },
  'base-sha': { type: 'string' },
  patch: { type: 'string' },
  'carried-from': { type: 'string' },
  home: { type: 'string' },
  auth: { type: 'string' },
  snap: { type: 'string' },
  deny: { type: 'string' },
  'sodium-dir': { type: 'string' },
  events: { type: 'string' },
  last: { type: 'string' },
  stderr: { type: 'string' },
  pr: { type: 'string' },
  'repo-slug': { type: 'string' },
  'target-url': { type: 'string' },
  mode: { type: 'string' },
  issue: { type: 'string' },
  slug: { type: 'string' },
  type: { type: 'string' },
  size: { type: 'string' },
  risk: { type: 'string' },
  owner: { type: 'string' },
  author: { type: 'string' },
  title: { type: 'string' },
  date: { type: 'string' },
  plan: { type: 'string' },
  step: { type: 'string' },
  'no-claim': { type: 'boolean' },
  'no-setup': { type: 'boolean' },
  'no-github': { type: 'boolean' },
  worker: { type: 'string' },
  tool: { type: 'string' },
  once: { type: 'boolean' },
  'max-iterations': { type: 'string' },
  'no-wait': { type: 'boolean' },
  json: { type: 'boolean' },
  profile: { type: 'string' },
  bot: { type: 'string' },
};

async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    log(HELP);
    return 0;
  }
  const dd = rest.indexOf('--');
  const extra = dd >= 0 ? rest.slice(dd + 1) : [];
  const args = dd >= 0 ? rest.slice(0, dd) : rest;
  const scan = scanArgs(args, OPTIONS);
  if (scan.help) {
    log(HELP);
    return 0;
  }
  if (scan.unknown.length) {
    process.stderr.write(`알 수 없는 옵션: ${scan.unknown.join(', ')}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: OPTIONS,
  });
  const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : undefined);
  const flag = (k: string) => values[k] === true;
  const cwd = process.cwd();
  const worker = str('worker') ?? process.env.HARNESS_WORKER ?? 'session';

  if ((STANDARD_COMMANDS as string[]).includes(cmd)) {
    const info = repoInfo(cwd);
    const cfg = loadConfig(info.root);
    const name = cmd as StandardName;
    const r = await runStandard(name, info.root, cfg, {
      checkMode: name === 'fmt' && flag('check'),
      stream: true,
      extraArgs: extra,
    });
    if (r.notApplicable) {
      log(`${name}: 프로파일 ${cfg.profile}에는 해당 없음`);
      return 0;
    }
    if (!r.ok) process.stderr.write(describeFailure(r, cfg.commands[name]?.timeoutSec) + '\n');
    return r.ok ? 0 : r.result?.code || 1;
  }

  switch (cmd) {
    case 'check': {
      const info = repoInfo(cwd);
      const cfg = loadConfig(info.root);
      const only = str('only')
        ?.split(',')
        .filter((s): s is CheckStep => (CHECK_STEPS as readonly string[]).includes(s));
      const r = await runCheck(info, cfg, {
        ci: flag('ci'),
        noCache: flag('no-cache'),
        base: str('base'),
        only,
      });
      return r.ok ? 0 : 1;
    }
    case 'doc-lint': {
      const info = repoInfo(cwd);
      const r = docLint(info.root, loadConfig(info.root));
      printDocLint(r);
      log(
        r.errors.length
          ? `doc-lint: 오류 ${r.errors.length}건`
          : `doc-lint: 통과(경고 ${r.warnings.length}건)`,
      );
      return r.errors.length ? 1 : 0;
    }
    case 'bypass-scan':
    case 'secret-scan': {
      const info = repoInfo(cwd);
      const cfg = loadConfig(info.root);
      const base =
        str('base') ?? defaultBase(info.root, cfg.github.remote, cfg.github.defaultBranch);
      const list =
        cmd === 'bypass-scan'
          ? bypassScan(info.root, cfg, { base, committedOnly: flag('ci') })
          : secretScan(info.root, { base, committedOnly: flag('ci') });
      for (const p of list) process.stderr.write(formatProblem(p) + '\n');
      log(list.length ? `${cmd}: ${list.length}건` : `${cmd}: 통과`);
      return list.length ? 1 : 0;
    }
    case 'plan-gate': {
      const root = path.resolve(str('repo') ?? repoInfo(cwd).root);
      const cfg = loadConfig(path.resolve(str('config-root') ?? root));
      const branch = str('head-ref') ?? repoInfo(root).branch;
      const base = str('base') ?? defaultBase(root, cfg.github.remote, cfg.github.defaultBranch);
      const mode = str('mode') === 'plan' ? 'plan' : 'pr';
      const r = planGate({ root, base, branch, mode, cfg });
      for (const n of r.notes) log(`참고: ${n}`);
      for (const p of r.problems) process.stderr.write(formatProblem(p) + '\n');
      log(
        r.problems.length
          ? `plan-gate: 실패 ${r.problems.length}건 (${branch})`
          : `plan-gate: 통과 (${branch}, ${r.plan?.file})`,
      );
      return r.problems.length ? 1 : 0;
    }
    case 'required-checks': {
      const info = repoInfo(cwd);
      // 다른 명령처럼 현재 작업 트리의 설정을 쓴다(읽기 전용 확인 도구)
      const cfg = loadConfig(info.root);
      const actual = toRequiredChecks(getGitHub(info.root).branchInfo(cfg.github.defaultBranch));
      const r = compareRequiredChecks(actual, cfg.ci);
      for (const l of r.lines) log(l);
      log(
        r.ok
          ? 'required-checks: 통과'
          : 'required-checks: 실패 — 등록은 제작자가 리포 설정에서 한다(0.2절). 봇은 바꾸지 않는다(R20)',
      );
      return r.ok ? 0 : 1;
    }
    case 'record-review': {
      const token = process.env.GH_TOKEN ?? '';
      if (!token) {
        process.stderr.write('record-review: 환경 변수 GH_TOKEN(검증 App 토큰)이 없다\n');
        return 2;
      }
      const needed = str('needed');
      if (needed !== 'true' && needed !== 'false') {
        process.stderr.write('record-review: --needed true|false가 필요하다\n');
        return 2;
      }
      const file = str('verdict');
      const headSha = str('head-sha') ?? '';
      const repo = str('repo-slug') ?? '';
      const targetUrl = str('target-url') ?? '';
      const p = await recordReview({
        context: str('context') ?? '',
        needed: needed === 'true',
        raw: file && existsSync(file) ? readFileSync(file, 'utf8') : null,
        secrets: (process.env.SCAN_SECRETS ?? '').split('\n').filter(Boolean),
        headSha,
        repo,
        post: githubStatusPoster({ token, repo, sha: headSha, targetUrl }),
        patch: str('patch') || undefined,
        carriedFrom: str('carried-from') || undefined,
        // 형식 검사와 시크릿 스캔을 통과한 판정만 온다. 원장(#55) 전에는 기록 job 로그가 지적을 보는 곳이다
        onVerdict: (v) => {
          // 본문은 PR 내용에 영향받는 LLM 출력이다. 한 줄로 만들고 접두어를 붙여 워크플로 명령 줄이 생기지 않게 한다
          log(
            `record-review: 판정 ${v.verdict} (검증자가 본 위험도 ${v.risk}) — ${oneLine(v.summary)}`,
          );
          for (const f of v.findings) {
            log(`  [${f.severity}] ${oneLine(f.file)}:${f.line} ${oneLine(f.title)}`);
            log(`    근거: ${oneLine(f.evidence)}`);
            log(`    제안: ${oneLine(f.suggestion)}`);
          }
        },
      });
      log(`record-review: ${p.context} = ${p.state} — ${p.description}`);
      return p.state === 'error' ? 1 : 0;
    }
    case 'review-plan': {
      const root = path.resolve(str('repo') ?? repoInfo(cwd).root);
      const cfg = loadConfig(path.resolve(str('config-root') ?? root));
      const base = str('base');
      const branch = str('head-ref');
      const output = process.env.GITHUB_OUTPUT;
      if (!base || !branch || !output) {
        process.stderr.write(
          'review-plan: --base, --head-ref와 환경 변수 GITHUB_OUTPUT이 필요하다\n',
        );
        return 2;
      }
      const r = planReview({ root, cfg, base, branch });
      writeReviewInput({ root, base, branch, risk: r.risk, reasons: r.reasons });
      appendFileSync(output, `risk=${r.risk}\nclaude=${r.claude}\ncodex=${r.codex}\n`);
      // 승인 이어받기(10.3절). plan job만 PR 번호를 준다. 판정하지 못하면 이어받지 않는다(다시 검증)
      const number = Number(str('pr-number'));
      const baseSha = str('base-sha');
      if (Number.isInteger(number) && number > 0 && baseSha) {
        const carried = { claude: '', codex: '' };
        let patch = '';
        try {
          patch = patchId(root, base);
          const bot = cfg.ci.recorderBot ?? '';
          const need = (['claude', 'codex'] as const).filter((k) => r[k]);
          const candidates =
            bot && patch && r.risk !== 'high' && need.length
              ? await fetchCandidates({
                  api: githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL),
                  repo: process.env.GITHUB_REPOSITORY ?? '',
                  number,
                  headSha: git(['rev-parse', 'HEAD'], root),
                  recorderBot: bot,
                  contexts: need.map((k) => `review/${k}`),
                })
              : [];
          const prFiles = changedFiles(root, base, 'HEAD');
          for (const k of need) {
            const c = carryOver({
              patch,
              risk: r.risk,
              prFiles,
              candidates,
              changedOnBaseSince: (old) => changedOnBaseSince(root, baseSha, old),
              samePrContent: (old) => samePrContent(root, old, prFiles),
              recorderBot: bot,
              context: `review/${k}`,
            });
            if ('from' in c) carried[k] = c.from;
            log(
              `review-plan: review/${k} ${'from' in c ? `이어받음 ← ${c.from.slice(0, 12)}` : `다시 검증 — ${c.no}`}`,
            );
          }
        } catch (e) {
          const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);
          log(`review-plan: 이어받기를 판정하지 못했다(다시 검증) — ${msg}`);
          carried.claude = '';
          carried.codex = '';
        }
        appendFileSync(
          output,
          `patch=${patch}\ncarry_claude=${carried.claude}\ncarry_codex=${carried.codex}\n`,
        );
      }
      log(
        `review-plan: 위험도 ${r.risk}, 작성 도구 ${r.author || '알 수 없음'} → claude=${r.claude} codex=${r.codex}`,
      );
      for (const why of r.reasons) log(`  - ${why}`);
      return 0;
    }
    case 'claude-scan': {
      const logFile = str('log');
      const prDir = str('pr');
      const out = str('out');
      if (!logFile || !prDir || !out) {
        process.stderr.write('claude-scan: --log, --pr, --out이 필요하다\n');
        return 2;
      }
      const r = scanClaudeRun({
        log: existsSync(logFile) ? readFileSync(logFile, 'utf8') : '',
        prDir,
        secrets: (process.env.SCAN_SECRETS ?? '').split('\n').filter(Boolean),
      });
      for (const l of r.report) log(`claude-scan: ${l}`);
      if (!r.ok) {
        log(`claude-scan: 실패 — ${r.reason}`);
        if (r.errorText !== undefined) log(`claude-scan: 오류 문구: ${r.errorText}`);
        return 1;
      }
      writeFileSync(out, JSON.stringify(r.verdict) + '\n');
      log('claude-scan: 통과, 판정을 냈다');
      return 0;
    }
    case 'codex-auth': {
      const sub = positionals[0];
      const need = (...keys: string[]) => {
        const missing = keys.filter((k) => !str(k));
        if (missing.length)
          throw new Error(`codex-auth ${sub}: --${missing.join(', --')}가 필요하다`);
        return keys.map((k) => str(k) as string);
      };
      try {
        if (sub === 'restore') {
          const [home] = need('home');
          const r = restoreAuth(process.env.CODEX_AUTH_JSON ?? '', home);
          log(
            `codex-auth: restore sha8=${r.sha8} fields=${r.fields.join(',')} api_key=${r.apiKey}`,
          );
        } else if (sub === 'snapshot') {
          const [auth, out] = need('auth', 'out');
          writeFileSync(out, JSON.stringify(snapshotAuth(auth)));
        } else if (sub === 'diff') {
          const [snap, auth] = need('snap', 'auth');
          const before = JSON.parse(readFileSync(snap, 'utf8')) as AuthSnapshot;
          const d = diffAuth(before, auth);
          log(
            `codex-auth: after sha8=${d.sha8} changed=${d.changed} fields_changed=${d.fieldsChanged.join(',') || '-'}`,
          );
        } else if (sub === 'config') {
          const [home, prDir, deny] = need('home', 'pr', 'deny');
          const denyDirs = deny.split(':').filter(Boolean);
          writeCodexConfig({ home, prDir, denyDirs });
          log(`codex-auth: config pr=${prDir} deny=${denyDirs.join(',')}`);
        } else if (sub === 'seal') {
          const [auth, dir] = need('auth', 'sodium-dir');
          const output = process.env.GITHUB_OUTPUT;
          if (!output) throw new Error('codex-auth seal: 환경 변수 GITHUB_OUTPUT이 없다');
          const sealed = await sealAuth(auth, process.env.PUBKEY ?? '', dir);
          appendFileSync(output, `sealed=${sealed}\n`);
          log('codex-auth: seal ok');
        } else {
          process.stderr.write('codex-auth: restore | snapshot | diff | config | seal\n');
          return 2;
        }
      } catch (e) {
        // 인증 도구의 오류 문구는 값을 담지 않는다(codex-auth.ts). 스택은 내지 않는다
        process.stderr.write(`codex-auth: 실패 — ${e instanceof Error ? e.message : '오류'}\n`);
        return 1;
      }
      return 0;
    }
    case 'codex-schema': {
      const out = str('out');
      if (!out) {
        process.stderr.write('codex-schema: --out이 필요하다\n');
        return 2;
      }
      const src = path.join(import.meta.dirname, 'cross-review', 'verdict.schema.json');
      writeFileSync(
        out,
        JSON.stringify(codexOutputSchema(JSON.parse(readFileSync(src, 'utf8')))) + '\n',
      );
      return 0;
    }
    case 'codex-scan': {
      const eventsFile = str('events');
      const prDir = str('pr');
      const out = str('out');
      if (!eventsFile || !prDir || !out) {
        process.stderr.write('codex-scan: --events, --pr, --out이 필요하다\n');
        return 2;
      }
      const readOr = (f?: string) => (f && existsSync(f) ? readFileSync(f, 'utf8') : '');
      const r = scanCodexRun({
        events: readOr(eventsFile),
        last: readOr(str('last')),
        logs: [readOr(str('stderr'))],
        prDir,
        // 실행 전 시크릿과 실행 뒤 파일(갱신됐을 수 있다)의 토큰을 모두 찾는다
        secrets: [
          ...new Set([
            ...authTokenValues(process.env.SCAN_AUTH_JSON ?? ''),
            ...authTokenValues(readOr(str('auth'))),
          ]),
        ],
      });
      for (const l of r.report) log(`codex-scan: ${l}`);
      if (!r.ok) {
        log(`codex-scan: 실패 — ${r.reason}`);
        if (r.errorText !== undefined) log(`codex-scan: 오류 문구: ${r.errorText}`);
        return 1;
      }
      writeFileSync(out, JSON.stringify(r.verdict) + '\n');
      log('codex-scan: 통과, 판정을 냈다');
      return 0;
    }
    case 'ci-pr': {
      const eventFile = str('event');
      const bodyOut = str('body-out');
      const output = process.env.GITHUB_OUTPUT;
      const repo = process.env.GITHUB_REPOSITORY ?? '';
      if (!eventFile || !bodyOut || !output || !repo) {
        process.stderr.write(
          'ci-pr: --event, --body-out과 환경 변수 GITHUB_OUTPUT, GITHUB_REPOSITORY가 필요하다\n',
        );
        return 2;
      }
      const r = await resolvePr({
        eventName: process.env.GITHUB_EVENT_NAME ?? '',
        event: JSON.parse(readFileSync(eventFile, 'utf8')),
        repo,
        api: githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL),
      });
      if ('skip' in r) {
        appendFileSync(output, 'skip=true\n');
        log(`ci-pr: 판정하지 않는다 — ${r.skip}`);
        return 0;
      }
      // head ref는 git ref라 줄바꿈이 없지만, 출력 파일 형식을 깨는 값은 거절한다
      if (/[\r\n]/.test(r.headRef)) throw new Error('head ref에 줄바꿈이 있다');
      writeFileSync(bodyOut, r.body);
      appendFileSync(
        output,
        `skip=false\nnumber=${r.number}\nhead_sha=${r.headSha}\nhead_ref=${r.headRef}\nbase_sha=${r.baseSha}\n`,
      );
      log(`ci-pr: PR #${r.number} head ${r.headSha.slice(0, 12)}`);
      return 0;
    }
    case 'gates': {
      const root = path.resolve(str('repo') ?? repoInfo(cwd).root);
      const cfg = loadConfig(path.resolve(str('config-root') ?? root));
      const out = str('out');
      const base = str('base');
      const branch = str('head-ref');
      if (!out || !base || !branch) {
        process.stderr.write('gates: --out, --base, --head-ref가 필요하다\n');
        return 2;
      }
      const headSha = git(['rev-parse', 'HEAD'], root);
      const rf = str('reviews');
      const reviews = rf && existsSync(rf) ? parseReviews(readFileSync(rf, 'utf8')) : null;
      const bf = str('pr-body');
      const prBody = bf && existsSync(bf) ? readFileSync(bf, 'utf8') : null;
      const r = await runGates({ root, cfg, base, branch, headSha, reviews, prBody });
      writeFileSync(out, JSON.stringify(r, null, 2) + '\n');
      const md = summaryMarkdown(r);
      const summary = str('summary');
      if (summary) appendFileSync(summary, md);
      log(md);
      return 0;
    }
    case 'record-status': {
      const file = str('results');
      const headSha = str('head-sha') ?? '';
      const repo = str('repo-slug') ?? '';
      const targetUrl = str('target-url') ?? '';
      const token = process.env.GH_TOKEN ?? '';
      if (!token) {
        process.stderr.write('record-status: 환경 변수 GH_TOKEN(검증 App 토큰)이 없다\n');
        return 2;
      }
      const raw = file && existsSync(file) ? readFileSync(file, 'utf8') : null;
      const r = await recordStatuses({
        raw,
        headSha,
        repo,
        targetUrl,
        post: githubStatusPoster({ token, repo, sha: headSha, targetUrl }),
      });
      log(
        r.ok
          ? 'record-status: 기록함'
          : `record-status: 모든 기계 판정을 error로 기록함 — ${r.reason}`,
      );
      return r.ok ? 0 : 1;
    }
    case 'new-task': {
      const r = await newTask(cwd, {
        issue: str('issue') ? Number(str('issue')) : undefined,
        slug: str('slug'),
        type: str('type'),
        size: str('size') as 'small' | 'medium' | 'large' | undefined,
        risk: str('risk') as 'low' | 'normal' | 'high' | undefined,
        owner: str('owner') ?? worker,
        author: str('author'),
        title: str('title'),
        date: str('date'),
        plan: str('plan'),
        step: str('step') ? Number(str('step')) : undefined,
        claim: !flag('no-claim'),
        setup: !flag('no-setup'),
        github: !flag('no-github'),
      });
      log(JSON.stringify(r, null, 2));
      log(`\n다음: cd ${r.worktree} 에서 ${r.planFile}을 채워라(docs/harness/workflow.md).`);
      return 0;
    }
    case 'complete-step': {
      const r = completeStep(cwd);
      log(
        `계획 전용 커밋 ${r.commit.slice(0, 10)}: ${r.id} ${r.step === null ? '' : `step${r.step} `}완료${r.last ? ' (마지막 step: completed/로 이동)' : ''}`,
      );
      return 0;
    }
    case 'claim-heartbeat': {
      const info = repoInfo(cwd);
      claimHeartbeat(
        info.mainRoot,
        loadConfig(info.mainRoot),
        Number(str('issue')),
        str('owner') ?? worker,
      );
      log(`claim/${str('issue')} 생존 확인 push 완료`);
      return 0;
    }
    case 'start':
      return start(cwd, worker);
    case 'next': {
      const info = repoInfo(cwd);
      const cfg = loadConfig(info.mainRoot);
      const pick = pickNext({ main: info.mainRoot, cfg, gh: getGitHub(info.mainRoot), worker });
      if (flag('json'))
        log(
          JSON.stringify({
            kind: pick.task.kind,
            reason: pick.reason,
            waiting: pick.waiting,
            summary: describeTask(pick.task),
            excluded: pick.excluded,
          }),
        );
      else
        log(
          [
            describeTask(pick.task),
            `이유: ${pick.reason}`,
            ...pick.excluded.map(describeExcluded),
          ].join('\n'),
        );
      return 0;
    }
    case 'run': {
      const tool = (str('tool') ?? 'claude') as 'claude' | 'codex' | 'fake';
      const stop = await runRunner({
        cwd,
        worker: str('worker') ?? process.env.HARNESS_WORKER ?? 'runner-1',
        tool,
        once: flag('once'),
        maxIterations: str('max-iterations') ? Number(str('max-iterations')) : undefined,
        noWait: flag('no-wait'),
      });
      log(`runner 종료: ${stop}`);
      return stop === 'error' || stop === 'locked' || stop === 'agent-missing' ? 1 : 0;
    }
    case 'init':
      return init(repoInfo(cwd).root, str('profile') ?? '', {
        owner: str('owner'),
        bot: str('bot'),
      });
    default:
      process.stderr.write(`알 수 없는 명령: ${cmd}\n\n${HELP}`);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    if (e instanceof TaskError) process.stderr.write(`${e.message}\n`);
    else process.stderr.write(`오류: ${(e as Error).stack ?? String(e)}\n`);
    process.exit(e instanceof TaskError ? 3 : 1);
  },
);
