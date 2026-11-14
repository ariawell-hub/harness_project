// 하네스 CLI 진입점. 정규 호출: node scripts/harness.ts <명령> [옵션]
// 모든 명령은 비대화식이고, 종료 코드로 성공·실패를 알린다(6절).
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { STANDARD_COMMANDS, loadConfig, type StandardName } from './lib/config.ts';
import { defaultBase, git, repoInfo } from './lib/git.ts';
import { formatProblem, log } from './lib/util.ts';
import { runGates, summaryMarkdown } from './ci/gates.ts';
import { githubGet, resolvePr } from './ci/pr.ts';
import { parseReviews } from './gates/risk-gate.ts';
import { githubStatusPoster, recordStatuses } from './ci/record.ts';
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
        [--reviews <리뷰 API JSON>]        기계 판정 결과 파일(판정 job, 비밀 없음)
  record-status --results <파일> --head-sha <sha> --repo-slug <owner/name> --target-url <url>
                                           결과 검사 뒤 커밋 상태 기록(기록 job, 토큰은 GH_TOKEN)

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
  reviews: { type: 'string' },
  event: { type: 'string' },
  'body-out': { type: 'string' },
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
  const { values } = parseArgs({ args, allowPositionals: true, strict: false, options: OPTIONS });
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
      const r = runGates({ root, cfg, base, branch, headSha, reviews });
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
