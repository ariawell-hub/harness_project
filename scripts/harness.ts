// 하네스 CLI 진입점. 정규 호출: node scripts/harness.ts <명령> [옵션]
// 모든 명령은 비대화식이고, 종료 코드로 성공·실패를 알린다(6절).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { STANDARD_COMMANDS, loadConfig, type StandardName } from './lib/config.ts';
import { defaultBase, git, repoInfo } from './lib/git.ts';
import { formatProblem, log } from './lib/util.ts';
import { runGates, summaryMarkdown } from './ci/gates.ts';
import { planCarry } from './ci/binding.ts';
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
import { RevertError, actRevert, parseRevertAction, planRevert } from './ci/revert.ts';
import { compareRequiredChecks, toRequiredChecks } from './ci/protection.ts';
import { parseReviews } from './gates/risk-gate.ts';
import { REVIEWERS, ledgerData, parseLedgerData, type Ledger, type Reviewer } from './ci/ledger.ts';
import {
  checkWhere,
  githubLedgerApi,
  ledgerFromComments,
  listComments,
  loadLedger,
  recordCiFailure,
  recordLedger,
} from './ci/ledger-store.ts';
import { planHashes, planMode } from './ci/plan-hash.ts';
import { PLAN_HASH_RE } from './ci/results.ts';
import {
  parseRebuttalData,
  parseRebuttals,
  rebuttalData,
  writeRebuttalInput,
  type Rebuttal,
} from './ci/rebuttal.ts';
import {
  githubStatusPoster,
  oneLine,
  recordReview,
  recordStatuses,
  reviewLogLines,
} from './ci/record.ts';
import { parseReproResults, reproResultsData, runRepro } from './ci/repro.ts';
import { targetCheckOf } from './ci/revert-evidence.ts';
import { pinnedPrompt, promptFiles, writeRoundInput } from './ci/review-round.ts';
import { validateVerdict, type Verdict } from './ci/verdict.ts';
import { writeReviewInput } from './ci/review-input.ts';
import { planReview } from './ci/review-plan.ts';
import { CHECK_STEPS, runCheck, type CheckStep } from './commands/check.ts';
import { init } from './commands/init.ts';
import { describeFailure, runStandard } from './commands/standard.ts';
import { describeExcluded, describeTask, start } from './commands/start.ts';
import { prReady } from './commands/pr-ready.ts';
import { prState } from './commands/pr-state.ts';
import { TaskError, claimHeartbeat, completeStep, newTask } from './commands/task.ts';
import { bypassScan } from './gates/bypass-scan.ts';
import { revertCheck, revertTarget, type RevertCheck } from './gates/revert-check.ts';
import { docLint, printDocLint } from './gates/doc-lint.ts';
import { planGate, type PlanG1 } from './gates/plan-gate.ts';
import { secretScan } from './gates/secret-scan.ts';
import { getGitHub, runIdOf } from './lib/github.ts';
import { pickNext } from './runner/next.ts';
import { runRunner } from './runner/run.ts';
import { runWorkers, workerNames } from './runner/workers.ts';

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
  pr-ready [--undo]                        승인 요청 전 조건 확인 뒤 PR 초안 해제(--undo: 초안으로 되돌림)
  pr-state [--pr <번호>]                   PR의 필수 체크를 출처와 함께 보이고 분류한다(읽기만. 번호가 없으면 현재 브랜치의 PR)
  claim-heartbeat --issue <N>              선점 생존 확인
  run [--worker <이름> | --prefix runner] [--tool claude|codex] [--once] [--max-iterations N] [--no-wait]
                                           runner. --worker(또는 HARNESS_WORKER)가 없으면 limits.workers만큼
                                           작업자 프로세스(<접두어>-1, <접두어>-2 …)를 띄운다

게이트:
  plan-gate [--repo <dir>] [--config-root <dir>] [--base <sha>] [--head-ref <브랜치>] [--mode pr|plan]
  doc-lint | bypass-scan [--ci] [--base <sha>] | secret-scan [--ci] [--base <sha>]

CI(gates 워크플로, 10.4절):
  ci-pr --event <이벤트 JSON> --body-out <파일>
                                           판정할 PR을 정해 $GITHUB_OUTPUT에 쓴다(이벤트 이름·리포·토큰은 환경 변수)
  gates --repo <pr> --config-root <base> --base <sha> --head-ref <브랜치> --out <파일> [--summary <파일>]
        [--reviews <리뷰 API JSON>] [--pr-body <본문 파일>] [--pr-number <N>]
                                           기계 판정 결과 파일(판정 job, 비밀 없음)
                                           PR 번호를 주면 plan-gate가 원장의 계획 승인을 읽는다(G1, 읽기 토큰은 GH_TOKEN)
                                           브랜치가 revert/<SHA>면 그 커밋의 main check 결론을 읽어 revert-check를 판정한다
                                           (10.3절. GITHUB_REPOSITORY, GH_TOKEN의 checks: read)
  record-status --results <파일> --head-sha <sha> --repo-slug <owner/name> --target-url <url>
                                           결과 검사 뒤 커밋 상태 기록(기록 job, 토큰은 GH_TOKEN)

  record-review --context <review/claude|review/codex> --needed <true|false> --verdict <파일>
                --head-sha <sha> --repo-slug <owner/name> --target-url <url> [--patch <id>] [--carried-from <sha>]
                [--pr-number <N> --config-root <base> --prompt-base <sha> --round-changed <base64 JSON>]
                [--repro-results <base64 JSON>] [--mode <plan|code> --plan-hash <해시>]
                                           검증자 판정 검사 뒤 review/* 기록(스캔할 비밀은 SCAN_SECRETS에 줄 단위)
                                           PR 번호를 주면 지적 원장 댓글을 고치고 review-ledger도 기록한다(토큰은 LEDGER_TOKEN)
                                           mode가 plan이면 review/*가 success일 때 원장에 계획 승인을 남긴다(G1)
  review-plan --repo <pr> --config-root <base> --base <sha> --head-ref <브랜치> [--pr-number <N>] [--base-sha <sha>]
              [--reviewer <claude|codex>] [--ledger <base64 JSON>] [--rebuttals <base64 JSON>]
                                           위험도와 필요한 검증자를 $GITHUB_OUTPUT에 쓰고 검증 입력(pr/.harness-review/)을 만든다
                                           revert-check가 확인한 revert/<SHA> PR은 검증자를 돌리지 않는다(10.3절)
                                           mode(plan: PR이 계획 폴더만 바꿨다 | code)와 plan_hash(계획 핵심 섹션 해시)도 낸다(G1)
                                           PR 번호와 base SHA를 주면 승인 이어받기(patch, carry_claude, carry_codex)도 판정한다(10.3절)
                                           검증자와 PR 번호(원장을 API로 읽고 ledger 출력) 또는 --ledger(받은 원장)를 주면
                                           원장·라운드 입력을 쓰고 round, prompt_base, round_changed를 낸다(10.2절)
  repro --verdict <verdict.json> --repo <pr> --config-root <base>
                                           판정의 재현 테스트를 PR 체크아웃에 붙여 실행하고 results를 $GITHUB_OUTPUT에 쓴다(재현 job)
  review-prompt --base-dir <base> --files <a.md,b.md> --out <파일> [--prompt-base <sha>] [--mode <plan|code>]
                                           검증 프롬프트를 이어 붙인다. 프롬프트 버전이 있으면 그 커밋의 파일을 쓴다(10.2절 (2))
                                           mode가 plan이면 계획 검증 프롬프트(prompt-plan.md)를 첫 파일 뒤에 붙인다
  revert-plan --event <이벤트 JSON>        main check 실패(workflow_run) 뒤 할 일을 정해 $GITHUB_OUTPUT에 action·data를 쓴다(읽기만, 10.3절)
  revert-act --data <base64 JSON> --run-url <url>
                                           정한 일을 한다: 실패한 job 재실행 | revert/<SHA> PR·자동 병합·Issue 재오픈 | 에스컬레이션
                                           (revert environment의 봇 토큰은 GH_TOKEN. main에 직접 push하지 않는다)
  ledger-ci-failure --config-root <base> --pr-number <N> --head-sha <sha> --repo-slug <owner/name> --run-url <url> --prompt-base <sha>
                                           check 실패를 지적 원장에 남긴다(토큰은 LEDGER_TOKEN)
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
  undo: { type: 'boolean' },
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
  reviewer: { type: 'string' },
  'prompt-base': { type: 'string' },
  'round-changed': { type: 'string' },
  'base-dir': { type: 'string' },
  files: { type: 'string' },
  'run-url': { type: 'string' },
  data: { type: 'string' },
  ledger: { type: 'string' },
  rebuttals: { type: 'string' },
  'repro-results': { type: 'string' },
  'plan-hash': { type: 'string' },
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
  prefix: { type: 'string' },
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
      // G1: 로컬에서는 원장을 보지 않는다. 해시만 넘겨 "CI에서 계획 승인이 필요한가"를 알린다
      let g1: PlanG1 | undefined;
      try {
        const h = base ? planHashes(root, base, branch) : null;
        if (h) g1 = { ...h, reviewers: REVIEWERS };
      } catch {
        // 계획이 깨졌으면 plan-gate의 다른 검사가 알린다
      }
      const r = planGate({ root, base, branch, mode, cfg, g1 });
      for (const n of r.notes) log(`참고: ${n}`);
      for (const p of r.problems) process.stderr.write(formatProblem(p) + '\n');
      log(
        r.problems.length
          ? `plan-gate: 실패 ${r.problems.length}건 (${branch})`
          : `plan-gate: 통과 (${branch}, ${r.plan?.file})`,
      );
      return r.problems.length ? 1 : 0;
    }
    case 'pr-state': {
      const n = str('pr');
      if (n !== undefined && !/^[1-9]\d*$/.test(n)) {
        process.stderr.write('pr-state: --pr에는 PR 번호를 준다\n');
        return 2;
      }
      return prState(cwd, n === undefined ? null : Number(n));
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
      let seen: Verdict | null = null;
      const p = await recordReview({
        context: str('context') ?? '',
        needed: needed === 'true',
        raw: file && existsSync(file) ? readFileSync(file, 'utf8') : null,
        secrets: (process.env.SCAN_SECRETS ?? '').split('\n').filter(Boolean),
        headSha,
        repo,
        post: githubStatusPoster({
          token,
          repo,
          sha: headSha,
          targetUrl,
          apiUrl: process.env.GITHUB_API_URL,
        }),
        patch: str('patch') || undefined,
        carriedFrom: str('carried-from') || undefined,
        // 형식 검사와 시크릿 스캔을 통과한 판정만 온다. 원장에는 위치와 제목만 남으므로 근거·제안은 이 로그에서 본다(10.1절)
        onVerdict: (v) => {
          seen = v;
          for (const line of reviewLogLines(v)) log(line);
        },
      });
      log(`record-review: ${p.context} = ${p.state} — ${p.description}`);
      // 지적 원장(10.2절 (4)). 판정 워크플로만 PR 번호를 준다. 원장 실패는 review-ledger = error로 남고 이 job은 실패시키지 않는다
      if (str('pr-number') !== undefined) {
        // 기록 job은 scripts와 설정 파일만 체크아웃한다. 설정 위치는 --config-root로 받는다
        const cfg = loadConfig(path.resolve(str('config-root') ?? '.'));
        const ledgerToken = process.env.LEDGER_TOKEN ?? '';
        let changed: string[] | null = null;
        try {
          const raw = JSON.parse(Buffer.from(str('round-changed') ?? '', 'base64').toString());
          if (Array.isArray(raw) && raw.every((x) => typeof x === 'string')) changed = raw;
        } catch {
          // 목록이 없거나 깨졌으면 모르는 것으로 본다(2라운드부터 새 P1은 동결된다)
        }
        // 재현 job 결과(10.2절 (3)). PR 코드가 만든 값이라 순번과 값만 받는다. 형식이 다르면 없는 것으로 본다
        const v = seen as Verdict | null;
        const outcomes = v ? parseReproResults(str('repro-results') ?? '', v.findings.length) : [];
        if (outcomes === null) log('record-review: 재현 결과 형식이 달라 쓰지 않는다');
        const reproMap = new Map((outcomes ?? []).map((x) => [x.index, x.result] as const));
        for (const x of outcomes ?? [])
          log(`record-review: 재현 findings[${x.index}] = ${x.result}`);
        // 계획 승인(G1): plan job이 "PR이 계획 폴더만 바꿨다"고 판정한 head에서만 남긴다. 코드가 섞인 판정은 남기지 않는다
        const planHashArg = str('plan-hash') ?? '';
        const isPlan = str('mode') === 'plan';
        if (isPlan && !PLAN_HASH_RE.test(planHashArg))
          log('record-review: 계획 해시 형식이 달라 계획 승인을 기록하지 않는다');
        const plan =
          isPlan && PLAN_HASH_RE.test(planHashArg)
            ? {
                hash: planHashArg,
                approved: p.state === 'success' ? true : p.state === 'failure' ? false : null,
              }
            : undefined;
        if (plan)
          log(
            `record-review: 계획 검증(G1) 해시 ${plan.hash.slice(0, 12)} — ${p.context} ${plan.approved === null ? '판정 없음' : plan.approved ? '승인' : '승인 아님'}`,
          );
        const l = await recordLedger({
          reviewer: (p.context.split('/')[1] ?? '') as Reviewer,
          verdict: seen,
          headSha,
          repo,
          number: Number(str('pr-number')),
          recorderBot: cfg.ci.recorderBot ?? '',
          promptBase: str('prompt-base') ?? '',
          changedSinceLastRound: changed,
          repro: reproMap,
          plan,
          api: ledgerToken ? githubLedgerApi(ledgerToken, process.env.GITHUB_API_URL) : null,
          post: githubStatusPoster({
            token,
            repo,
            sha: headSha,
            targetUrl,
            apiUrl: process.env.GITHUB_API_URL,
          }),
        });
        log(`record-review: ${l.context} = ${l.state} — ${l.description}`);
      }
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
      // 확인된 revert PR(10.3절)은 검증자를 돌리지 않는다. 대상의 check를 조회하지 못하면 평소대로 검증한다
      const target = revertTarget(branch);
      let revert: RevertCheck | undefined;
      if (target) {
        const targetCheck = await targetCheckOf(
          githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL),
          process.env.GITHUB_REPOSITORY ?? '',
          target,
        );
        try {
          revert = revertCheck({ root, base, branch, targetCheck });
          log(`review-plan: revert-check ${revert.state} — ${revert.description}`);
        } catch (e) {
          log(`review-plan: revert-check를 판정하지 못했다 — ${(e as Error).message}`);
        }
      }
      const r = planReview({ root, cfg, base, branch, revert });
      writeReviewInput({ root, base, branch, risk: r.risk, reasons: r.reasons });
      appendFileSync(output, `risk=${r.risk}\nclaude=${r.claude}\ncodex=${r.codex}\n`);
      // 계획 검증(G1): PR이 바꾼 파일이 계획 폴더 안뿐이면 판정 job이 계획 검증 프롬프트를 덧붙이고 기록 job이 승인을 남긴다
      const pm = planMode({ root, base, branch });
      appendFileSync(output, `mode=${pm.mode}\nplan_hash=${pm.hash}\n`);
      log(`review-plan: mode=${pm.mode}, 계획 해시 ${pm.hash.slice(0, 12) || '없음'}`);
      // 승인 이어받기(10.3절). plan job만 PR 번호를 준다. 판정하지 못하면 이어받지 않는다(다시 검증)
      const number = Number(str('pr-number'));
      const baseSha = str('base-sha');
      if (Number.isInteger(number) && number > 0 && baseSha) {
        const c = await planCarry({
          root,
          base,
          baseSha,
          number,
          repo: process.env.GITHUB_REPOSITORY ?? '',
          risk: r.risk,
          need: { claude: r.claude, codex: r.codex },
          recorderBot: cfg.ci.recorderBot ?? '',
          api: githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL),
        });
        for (const n of c.notes) log(`review-plan: ${n}`);
        appendFileSync(
          output,
          `patch=${c.patch}\ncarry_claude=${c.claude}\ncarry_codex=${c.codex}\n`,
        );
      }
      // 라운드 입력(10.2절 (5))
      const reviewer = str('reviewer');
      const passed = str('ledger');
      const fromApi = Number.isInteger(number) && number > 0;
      if (reviewer && (fromApi || passed !== undefined)) {
        if (!(REVIEWERS as readonly string[]).includes(reviewer)) {
          process.stderr.write('review-plan: --reviewer는 claude | codex다\n');
          return 2;
        }
        let ledger: Ledger | null = null;
        let rebuttals: Rebuttal[] = [];
        if (fromApi) {
          // plan job: 검증 App 봇의 원장 댓글을 읽어 판정 job에 넘긴다(판정 job에는 GitHub 토큰을 주지 않는다)
          const repoSlug = process.env.GITHUB_REPOSITORY ?? '';
          const recorderBot = cfg.ci.recorderBot ?? '';
          try {
            const get = githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL);
            checkWhere({ repo: repoSlug, number, recorderBot });
            const comments = await listComments({ get, repo: repoSlug, number });
            ledger = ledgerFromComments(comments, recorderBot).ledger;
            if (ledger) {
              // 반박(10.2절 (4)): PR 작성자의 댓글에서 형식에 맞는 것만 넘긴다
              const pr = (await get(`repos/${repoSlug}/pulls/${number}`)) as {
                user?: { login?: unknown };
              };
              const author = typeof pr?.user?.login === 'string' ? pr.user.login : '';
              rebuttals = parseRebuttals({ comments, ledger, author, recorderBot, repo: repoSlug });
            }
          } catch (e) {
            // 원장이 있는데 읽지 못한 채 판정하면 프롬프트 버전 고정과 라운드 규칙이 조용히 풀린다. 판정 없이 실패한다(fail-closed)
            process.stderr.write(
              `review-plan: 원장을 읽지 못했다 — ${oneLine(e instanceof Error ? e.message : '오류')}\n`,
            );
            return 1;
          }
          appendFileSync(
            output,
            `ledger=${ledger ? ledgerData(ledger) : ''}\nrebuttals=${rebuttalData(rebuttals)}\n`,
          );
        } else if (passed) {
          ledger = parseLedgerData(passed);
          if (!ledger) {
            process.stderr.write('review-plan: --ledger 값이 원장 형식이 아니다\n');
            return 1;
          }
        }
        if (!fromApi) {
          // 판정 job: plan job이 넘긴 반박을 같은 규칙으로 다시 검사한다
          const parsed = parseRebuttalData(
            str('rebuttals') ?? '',
            ledger,
            process.env.GITHUB_REPOSITORY ?? '',
          );
          if (!parsed) {
            process.stderr.write('review-plan: --rebuttals 값이 반박 형식이 아니다\n');
            return 1;
          }
          rebuttals = parsed;
        }
        const round = writeRoundInput({ root, ledger, reviewer: reviewer as Reviewer });
        writeRebuttalInput(root, rebuttals);
        if (rebuttals.length)
          log(`review-plan: 반박 ${rebuttals.length}건(${rebuttals.map((r) => r.id).join(', ')})`);
        // 명령 인자 하나의 길이 한도(약 128KB) 안에서만 넘긴다. 넘으면 모르는 것으로 본다(새 P1은 동결된다)
        const encoded = round.changed
          ? Buffer.from(JSON.stringify(round.changed)).toString('base64')
          : '';
        const changed = encoded.length <= 100_000 ? encoded : '';
        appendFileSync(
          output,
          `round=${round.round}\nprompt_base=${round.promptBase}\nround_changed=${changed}\n`,
        );
        log(
          `review-plan: ${reviewer} ${round.round}라운드, 프롬프트 버전 ${round.promptBase.slice(0, 12) || '지금'}, 직전 판정 이후 바뀐 파일 ${round.changed ? round.changed.length : '알 수 없음'}`,
        );
      }
      log(
        `review-plan: 위험도 ${r.risk}, 작성 도구 ${r.author || '알 수 없음'} → claude=${r.claude} codex=${r.codex}`,
      );
      for (const why of r.reasons) log(`  - ${why}`);
      return 0;
    }
    case 'repro': {
      const file = str('verdict');
      const root = str('repo');
      const output = process.env.GITHUB_OUTPUT;
      if (!file || !root || !output) {
        process.stderr.write('repro: --verdict, --repo와 환경 변수 GITHUB_OUTPUT이 필요하다\n');
        return 2;
      }
      // 설정은 base의 것만 쓴다. PR 트리의 설정으로 명령을 바꿀 수 없다
      const cfg = loadConfig(path.resolve(str('config-root') ?? '.'));
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        // 판정이 없으면 실행할 것이 없다
      }
      const v = validateVerdict(parsed);
      if (!v.ok) {
        log('repro: 판정을 읽지 못해 실행하지 않는다');
        appendFileSync(output, 'results=\n');
        return 0;
      }
      const results = runRepro({ root: path.resolve(root), verdict: v.value, cfg: cfg.ci.repro });
      for (const r of results) log(`repro: findings[${r.index}] = ${r.result}`);
      if (!results.length) log('repro: 실행한 재현 테스트가 없다');
      appendFileSync(output, `results=${reproResultsData(results)}\n`);
      return 0;
    }
    case 'review-prompt': {
      const baseDir = str('base-dir');
      const files = (str('files') ?? '').split(',').filter(Boolean);
      const out = str('out');
      if (!baseDir || !files.length || !out) {
        process.stderr.write('review-prompt: --base-dir, --files, --out이 필요하다\n');
        return 2;
      }
      try {
        const promptBase = str('prompt-base') ?? '';
        writeFileSync(
          out,
          pinnedPrompt({ baseDir, promptBase, files: promptFiles(files, str('mode')) }),
        );
        log(
          `review-prompt: 프롬프트 버전 ${promptBase.slice(0, 12) || '지금(base 체크아웃)'}, 파일 ${promptFiles(files, str('mode')).join(', ')}`,
        );
      } catch (e) {
        process.stderr.write(`review-prompt: 실패 — ${e instanceof Error ? e.message : '오류'}\n`);
        return 1;
      }
      return 0;
    }
    case 'ledger-ci-failure': {
      const token = process.env.LEDGER_TOKEN ?? '';
      if (!token) {
        process.stderr.write('ledger-ci-failure: 환경 변수 LEDGER_TOKEN(검증 App 토큰)이 없다\n');
        return 1;
      }
      try {
        // 기록 job은 scripts와 설정 파일만 체크아웃한다. 설정 위치는 --config-root로 받는다
        const cfg = loadConfig(path.resolve(str('config-root') ?? '.'));
        await recordCiFailure({
          api: githubLedgerApi(token, process.env.GITHUB_API_URL),
          repo: str('repo-slug') ?? '',
          number: Number(str('pr-number')),
          recorderBot: cfg.ci.recorderBot ?? '',
          headSha: str('head-sha') ?? '',
          run: str('run-url') ?? '',
          promptBase: str('prompt-base') ?? '',
        });
        log('ledger-ci-failure: 원장에 check 실패를 남겼다');
      } catch (e) {
        process.stderr.write(
          `ledger-ci-failure: 실패 — ${oneLine(e instanceof Error ? e.message : '오류')}\n`,
        );
        return 1;
      }
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
    case 'revert-plan': {
      const eventFile = str('event');
      const output = process.env.GITHUB_OUTPUT;
      const repo = process.env.GITHUB_REPOSITORY ?? '';
      if (!eventFile || !output || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
        process.stderr.write(
          'revert-plan: --event와 환경 변수 GITHUB_OUTPUT, GITHUB_REPOSITORY가 필요하다\n',
        );
        return 2;
      }
      const info = repoInfo(cwd);
      const a = await planRevert({
        root: info.root,
        cfg: loadConfig(info.root),
        repo,
        api: githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL),
        event: JSON.parse(readFileSync(eventFile, 'utf8')),
      });
      const data = Buffer.from(JSON.stringify(a)).toString('base64');
      appendFileSync(output, `action=${a.action}\ndata=${data}\n`);
      log(`revert-plan: ${a.action}${'reason' in a ? ` — ${a.reason}` : ''}`);
      return 0;
    }
    case 'revert-act': {
      const data = str('data');
      const runUrl = str('run-url');
      if (!data || !runUrl) {
        process.stderr.write('revert-act: --data, --run-url이 필요하다\n');
        return 2;
      }
      const info = repoInfo(cwd);
      const gh = getGitHub(info.root);
      try {
        // plan job의 출력도 다시 검사한다: 형식, 실행 URL이 이 리포의 것인가(대상이 main 이력에 있는지는 actRevert가 본다)
        const a = parseRevertAction(JSON.parse(Buffer.from(data, 'base64').toString('utf8')));
        if (!runIdOf(runUrl, gh.repoSlug()))
          throw new RevertError('--run-url이 이 리포의 Actions 실행 URL이 아니다');
        const r = actRevert({ root: info.root, gh, cfg: loadConfig(info.root), runUrl }, a);
        log(`revert-act: ${r.done}`);
        return 0;
      } catch (e) {
        process.stderr.write(`revert-act: 실패 — ${(e as Error).message}\n`);
        return 1;
      }
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
      // G1: 원장(검증 App 봇 댓글)의 계획 승인. 판정 job의 읽기 토큰으로 읽는다. PR 번호가 없으면 읽지 않는다
      const number = Number(str('pr-number'));
      const planReview =
        Number.isInteger(number) && number > 0
          ? async () => {
              const stored = await loadLedger({
                get: githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL),
                repo: process.env.GITHUB_REPOSITORY ?? '',
                number,
                recorderBot: cfg.ci.recorderBot ?? '',
              });
              return stored.ledger?.planReview ?? null;
            }
          : undefined;
      // revert-check(10.3절): 대상 커밋의 main check 결론. 브랜치가 revert/<SHA>일 때만 runGates가 부른다
      const target = revertTarget(branch);
      const targetCheck = target
        ? () =>
            targetCheckOf(
              githubGet(process.env.GH_TOKEN ?? '', process.env.GITHUB_API_URL),
              process.env.GITHUB_REPOSITORY ?? '',
              target,
            )
        : undefined;
      const r = await runGates({
        root,
        cfg,
        base,
        branch,
        headSha,
        reviews,
        prBody,
        planReview,
        targetCheck,
      });
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
        post: githubStatusPoster({
          token,
          repo,
          sha: headSha,
          targetUrl,
          apiUrl: process.env.GITHUB_API_URL,
        }),
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
    case 'pr-ready': {
      const r = prReady(cwd, { undo: flag('undo') });
      log(
        r.undone
          ? `pr-ready: PR #${r.pr}을 초안으로 되돌리고 승인 요청 표시를 지웠다`
          : `pr-ready: PR #${r.pr}의 초안을 해제했다(승인 요청, head ${r.sha?.slice(0, 10)}). 이 뒤로는 커밋을 더 올리지 않는다`,
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
      const single = str('worker') ?? process.env.HARNESS_WORKER;
      if (!single) {
        // 작업자 여러 개(4.5절 운영): 작업자마다 프로세스 하나. 이름은 <접두어>-<번호>라 서로 겹치지 않는다
        const names = workerNames(
          str('prefix') ?? 'runner',
          loadConfig(repoInfo(cwd).mainRoot).limits.workers,
        );
        const pass = ['--tool', tool];
        if (flag('once')) pass.push('--once');
        if (str('max-iterations')) pass.push('--max-iterations', str('max-iterations')!);
        if (flag('no-wait')) pass.push('--no-wait');
        log(`runner 작업자 ${names.length}개: ${names.join(', ')}`);
        return runWorkers({ cwd, script: fileURLToPath(import.meta.url), names, args: pass });
      }
      const stop = await runRunner({
        cwd,
        worker: single,
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

/** 명령이 핸들을 남겨 자연 종료하지 못할 때 강제로 끝내기까지 기다리는 시간 */
const EXIT_GRACE_MS = 10_000;

/**
 * 종료 코드만 정하고 이벤트 루프가 비어 끝나게 한다. fetch를 쓴 뒤 바로 강제 종료하면
 * Windows의 Node 24가 libuv 단언(src\win\async.c)으로 죽는다(Issue #99).
 * 타이머는 unref라 프로세스를 붙잡지 않고, 남은 핸들이 있을 때만 강제로 끝낸다.
 */
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), EXIT_GRACE_MS).unref();
}

main(process.argv.slice(2)).then(finish, (e: unknown) => {
  if (e instanceof TaskError) process.stderr.write(`${e.message}\n`);
  else process.stderr.write(`오류: ${(e as Error).stack ?? String(e)}\n`);
  finish(e instanceof TaskError ? 3 : 1);
});
