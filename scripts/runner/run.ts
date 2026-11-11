// runner (4.5절). 할 일이 남아 있는 한 step마다 새 세션을 띄우고, AC·check로 직접 판정한다.
// 골격은 jha0313/harness_framework의 execute.py(step마다 새 세션, summary 누적, 에러를 넣은 재시도)를 따른다.
import {
  appendFileSync,
  existsSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { RESET_KEY, judge, readAttempts, recordAttempt, keyFailures } from '../lib/attempts.ts';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { runShell, tail } from '../lib/exec.ts';
import { getGitHub, type GitHubPort } from '../lib/github.ts';
import {
  defaultBase,
  fastForwardMain,
  git,
  gitTry,
  harnessStateDir,
  isClean,
  repoInfo,
  type RepoInfo,
} from '../lib/git.ts';
import { acceptanceCommands, findPlan, parseDoc, readIndex, section } from '../lib/plan.ts';
import { log, nowIso, warn } from '../lib/util.ts';
import { runCheck } from '../commands/check.ts';
import {
  ClaimError,
  appendProgress,
  completeStep,
  fetchRemote,
  newTask,
  releaseClaim,
  reopenStep,
  setPlanStatus,
  setStepStatus,
  slugFor,
} from '../commands/task.ts';
import { planGate } from '../gates/plan-gate.ts';
import { resolveAgentCommand, runSession, type AgentTool } from './agents.ts';
import { pickNext, readLocalPlans, type LocalPlan, type Pick } from './next.ts';
import { planningPrompt, stepPrompt } from './prompt.ts';

export interface RunnerOptions {
  cwd: string;
  worker: string;
  tool: AgentTool;
  /** 한 바퀴만 */
  once?: boolean;
  maxIterations?: number;
  /** 대기 간격(초). 기본은 설정의 pollSec */
  pollSec?: number;
  /** 할 일이 CI 대기뿐일 때 기다리지 않고 멈춘다(테스트용) */
  noWait?: boolean;
}

export type StopReason =
  | 'idle'
  | 'human'
  | 'time-limit'
  | 'usage-limit'
  | 'max-iterations'
  | 'once'
  | 'locked'
  | 'agent-missing'
  | 'error';

interface Ctx {
  o: RunnerOptions;
  main: RepoInfo;
  cfg: HarnessConfig;
  gh: GitHubPort;
  logFile: string;
  envWaitMs: number;
}

function event(ctx: Ctx, ev: string, data: Record<string, unknown> = {}): void {
  const entry = { ts: nowIso(), worker: ctx.o.worker, event: ev, ...data };
  appendFileSync(ctx.logFile, JSON.stringify(entry) + '\n');
  log(
    `[runner ${ctx.o.worker}] ${ev}${data.reason ? ': ' + data.reason : ''}${data.detail ? ' — ' + String(data.detail).slice(0, 200) : ''}`,
  );
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function acquireLock(main: RepoInfo, worker: string): string | null {
  const f = path.join(harnessStateDir(main, 'common'), `runner-${worker}.lock`);
  if (existsSync(f)) {
    const pid = Number(readFileSync(f, 'utf8').split('\n')[0]);
    try {
      if (pid && pid !== process.pid) {
        process.kill(pid, 0);
        return null; // 살아 있음
      }
    } catch {
      // 죽은 lock
    }
  }
  writeFileSync(f, `${process.pid}\n${nowIso()}\n`);
  return f;
}

/** main 체크아웃을 origin/main으로 빨리 감는다(깨끗할 때만). runner는 main의 훅·프로필을 쓴다.
 * 결과는 무시한다(매 바퀴 반복되므로 출력하지 않는다). 이유 출력은 `start`가 한다 */
function syncMain(ctx: Ctx): void {
  fastForwardMain(ctx.main.mainRoot, ctx.cfg.github.remote, ctx.cfg.github.defaultBranch);
}

function limitsOf(cfg: HarnessConfig) {
  return {
    ...cfg.failure,
    stepFailedCheckLimit: cfg.limits.stepFailedCheckLimit,
    stepSessionMinutesLimit: cfg.limits.stepSessionMinutesLimit,
  };
}

// ---------- 중단 (9.2절 5회 / 총량 상한) ----------

async function blockPlan(ctx: Ctx, l: LocalPlan, reason: string): Promise<void> {
  const info = repoInfo(l.worktree);
  const attempts = readAttempts(info)
    .filter((a) => a.plan === l.id && !a.ok && !a.env)
    .slice(-10);
  const doc = parseDoc(readFileSync(path.join(l.worktree, l.ref.file), 'utf8'));
  const goal = (section(doc.body, '목표') ?? doc.body.match(/^\s*-\s*목표:\s*(.*)$/m)?.[1] ?? '')
    .trim()
    .split('\n')[0];
  const counts = [...keyFailures(readAttempts(info), l.id)]
    .map(([k, v]) => `${k}(${v}회)`)
    .join(', ');
  try {
    setStepStatus(l.worktree, 'blocked');
    setPlanStatus(l.worktree, 'blocked', `중단: ${reason}`);
    gitTry(['push', '--quiet', '-u', ctx.cfg.github.remote, l.branch], l.worktree);
  } catch (e) {
    warn(`계획 blocked 기록 실패: ${(e as Error).message}`);
  }
  const mention = ctx.cfg.github.owner ? `@${ctx.cfg.github.owner} ` : '';
  const report = `${mention}runner가 계획을 멈췄다.

## 중단 보고: ${l.id}
- 목표: ${goal || '(계획 파일 참조)'}
- 실패 키: ${counts || reason}
- 시도 이력:
${attempts.map((a) => `  - ${a.ts} [${a.key}] ${(a.detail ?? '').split('\n').filter(Boolean).slice(-1)[0] ?? ''}`).join('\n') || '  - (기록 없음)'}
- 3회차 방법 전환 내용과 이유: 계획의 "의사결정 로그" 참조 (브랜치 \`${l.branch}\`)
- 추정 원인: ${reason}
- 교차 검증 의견: (2단계에서 추가)
- 사람이 결정할 것: A) 계획·AC를 고쳐 재개 / B) 범위를 줄여 재개 / C) 포기(abandoned) — 추천: A. 이 Issue에 제작자 계정으로 답을 달면 runner가 이어 간다.`;
  try {
    ctx.gh.addLabel(l.issue, ctx.cfg.github.needsHumanLabel);
    ctx.gh.comment(l.issue, report);
  } catch (e) {
    warn(`GitHub 알림 실패: ${(e as Error).message}`);
  }
  event(ctx, 'blocked', { plan: l.id, step: l.step, reason });
}

// ---------- 계획 작성 세션 ----------

async function doPlanning(ctx: Ctx, l: LocalPlan): Promise<'ok' | 'fail' | 'env'> {
  const info = repoInfo(l.worktree);
  const all = readAttempts(info);
  const v = judge(all, l.id, null, limitsOf(ctx.cfg));
  if (v.action === 'stop') {
    await blockPlan(ctx, l, v.reason ?? '계획 작성 반복 실패');
    return 'fail';
  }
  const issue = ctx.gh.getIssue(l.issue);
  const n = (keyFailures(all, l.id).get('plan:structure') ?? 0) + 1;
  const prompt = planningPrompt(l.worktree, l.ref, l.id, issue, all, n);
  event(ctx, 'session-start', { plan: l.id, kind: 'planning', attempt: n });
  const s = await runSession(
    ctx.o.tool,
    prompt,
    l.worktree,
    ctx.main,
    ctx.cfg,
    ctx.cfg.limits.sessionTimeoutMin * 60_000,
  );
  if (s.envFailure) {
    recordAttempt(info, {
      plan: l.id,
      step: null,
      key: 'session',
      ok: false,
      kind: 'session',
      env: true,
      durationMs: s.durationMs,
      detail: tail(s.output, 10),
    });
    return 'env';
  }
  recordAttempt(info, {
    plan: l.id,
    step: null,
    key: s.timedOut ? 'session:timeout' : 'session',
    ok: !s.timedOut,
    kind: 'session',
    durationMs: s.durationMs,
  });
  const ref = findPlan(l.worktree, l.id) ?? l.ref;
  const r = planGate({
    root: l.worktree,
    base: null,
    branch: l.branch,
    mode: 'plan',
    cfg: loadConfig(l.worktree),
  });
  if (r.problems.length) {
    const detail = r.problems.map((p) => `[${p.rule}] ${p.what} → ${p.how}`).join('\n');
    recordAttempt(info, {
      plan: l.id,
      step: null,
      key: 'plan:structure',
      ok: false,
      kind: 'plan',
      detail,
    });
    event(ctx, 'plan-invalid', { plan: l.id, detail });
    return 'fail';
  }
  recordAttempt(info, { plan: l.id, step: null, key: 'plan:structure', ok: true, kind: 'plan' });
  const text = readFileSync(path.join(l.worktree, ref.file), 'utf8');
  if (parseDoc(text).frontmatter?.status === 'draft')
    setPlanStatus(l.worktree, 'active', '계획 작성 완료');
  else {
    appendProgress(l.worktree, ref, '계획 작성 완료');
    git(['add', '-A', '--', 'docs/exec-plans'], l.worktree);
    gitTry(
      ['commit', '--quiet', '-m', `plan(${l.id}): 계획 작성`, '--', 'docs/exec-plans'],
      l.worktree,
    );
  }
  // 계획 외 파일이 바뀌었으면(코드 작성 금지 위반) 되돌리지 않고 기록만 남긴다. step 세션과 plan-gate가 이어서 본다
  if (!isClean(l.worktree)) warn(`계획 세션이 계획 밖 파일을 남겼다: ${l.worktree}`);
  event(ctx, 'planned', { plan: l.id });
  return 'ok';
}

// ---------- step 실행·판정 ----------

async function doStep(
  ctx: Ctx,
  l: LocalPlan,
  extra?: string,
): Promise<'ok' | 'fail' | 'env' | 'blocked'> {
  const info = repoInfo(l.worktree);
  const cfg = loadConfig(l.worktree);
  const before = readAttempts(info);
  const v = judge(before, l.id, l.step, limitsOf(ctx.cfg));
  if (v.action === 'stop') {
    await blockPlan(ctx, l, v.reason ?? '반복 실패');
    return 'blocked';
  }
  setStepStatus(l.worktree, 'in_progress');
  const ref = findPlan(l.worktree, l.id) ?? l.ref;
  const sessions = before.filter(
    (a) => a.plan === l.id && a.step === l.step && a.kind === 'session' && !a.env,
  ).length;
  const answerFile = path.join(harnessStateDir(info, 'worktree'), 'answer.md');
  const answer = existsSync(answerFile)
    ? `## 제작자 답변 (9.1절, 이 지시를 따른다)\n${readFileSync(answerFile, 'utf8')}`
    : '';
  const prompt = stepPrompt({
    root: l.worktree,
    ref,
    id: l.id,
    step: l.step,
    branch: l.branch,
    attempts: before,
    attemptNo: sessions + 1,
    switchApproach: v.action === 'switch',
    extra: [answer, extra].filter(Boolean).join('\n\n') || undefined,
  });
  event(ctx, 'session-start', {
    plan: l.id,
    step: l.step,
    attempt: sessions + 1,
    switch: v.action === 'switch',
  });
  const s = await runSession(
    ctx.o.tool,
    prompt,
    l.worktree,
    ctx.main,
    ctx.cfg,
    ctx.cfg.limits.sessionTimeoutMin * 60_000,
  );
  if (s.envFailure) {
    recordAttempt(info, {
      plan: l.id,
      step: l.step,
      key: 'session',
      ok: false,
      kind: 'session',
      env: true,
      durationMs: s.durationMs,
      detail: tail(s.output, 10),
    });
    event(ctx, 'env-failure', { plan: l.id, detail: tail(s.output, 3) });
    return 'env';
  }
  recordAttempt(info, {
    plan: l.id,
    step: l.step,
    key: s.timedOut ? 'session:timeout' : 'session',
    ok: !s.timedOut,
    kind: 'session',
    durationMs: s.durationMs,
    detail: s.timedOut
      ? `세션이 시간 제한 ${ctx.cfg.limits.sessionTimeoutMin}분을 넘겨 종료됐다`
      : undefined,
  });

  // ---- runner가 직접 판정 (세션의 "완료" 주장은 근거가 아니다) ----
  const acs = acceptanceCommands(l.worktree, ref, l.step);
  let ok = acs.length > 0;
  if (!acs.length)
    recordAttempt(info, {
      plan: l.id,
      step: l.step,
      key: 'ac:missing',
      ok: false,
      kind: 'ac',
      detail: 'AC 명령이 없다',
    });
  for (const cmd of acs) {
    const r = await runShell(cmd, { cwd: l.worktree, timeoutMs: cfg.limits.acTimeoutSec * 1000 });
    const pass = r.code === 0;
    recordAttempt(info, {
      plan: l.id,
      step: l.step,
      key: `ac:${cmd}`,
      ok: pass,
      kind: 'ac',
      durationMs: r.durationMs,
      detail: pass
        ? undefined
        : `$ ${cmd}\n${r.timedOut ? '시간 제한 초과\n' : ''}${tail(r.stdout + '\n' + r.stderr, 40)}`,
    });
    if (!pass) ok = false;
  }
  const check = await runCheck(info, cfg, { quiet: true });
  if (!check.ok) ok = false;
  if (!ok) {
    const failed = check.results.filter((r) => !r.ok).map((r) => r.name);
    event(ctx, 'judge-fail', {
      plan: l.id,
      step: l.step,
      detail: `AC ${acs.length}개, check 실패: ${failed.join(', ') || '없음'}`,
    });
    return 'fail';
  }

  // ---- 통과: 남은 변경 커밋 → 계획 전용 커밋 → push → PR → 자동 병합 ----
  if (!isClean(l.worktree)) {
    git(['add', '-A'], l.worktree);
    const idx = ref.kind === 'multi' ? readIndex(l.worktree, ref).steps[l.step ?? 0] : null;
    git(
      [
        'commit',
        '--quiet',
        '-m',
        `${String(l.fm.type ?? 'feat')}(${l.id}): ${idx ? `step${idx.step} ${idx.name}` : '작업'}`,
      ],
      l.worktree,
    );
  }
  let completed;
  try {
    completed = completeStep(l.worktree);
  } catch (e) {
    recordAttempt(info, {
      plan: l.id,
      step: l.step,
      key: 'plan:complete',
      ok: false,
      kind: 'plan',
      detail: (e as Error).message,
    });
    event(ctx, 'complete-fail', { plan: l.id, detail: (e as Error).message });
    return 'fail';
  }
  recordAttempt(info, { plan: l.id, step: l.step, key: 'plan:complete', ok: true, kind: 'plan' });
  const base = defaultBase(l.worktree, ctx.cfg.github.remote, ctx.cfg.github.defaultBranch);
  const gate = planGate({ root: l.worktree, base, branch: l.branch, mode: 'pr', cfg });
  if (gate.problems.length) {
    const detail = gate.problems.map((p) => `[${p.rule}] ${p.what} → ${p.how}`).join('\n');
    reopenStep(l.worktree, 'plan-gate 실패');
    recordAttempt(info, {
      plan: l.id,
      step: l.step,
      key: 'plan-gate',
      ok: false,
      kind: 'plan',
      detail,
    });
    event(ctx, 'plan-gate-fail', { plan: l.id, detail });
    return 'fail';
  }
  recordAttempt(info, { plan: l.id, step: l.step, key: 'plan-gate', ok: true, kind: 'plan' });
  const push = gitTry(
    ['push', '--quiet', '-u', ctx.cfg.github.remote, `HEAD:refs/heads/${l.branch}`],
    l.worktree,
  );
  if (!push.ok) {
    // runner 자신의 작업 브랜치에서만 lease로 덮어쓴다(에이전트에게는 금지, R14)
    const forced = gitTry(
      [
        'push',
        '--quiet',
        '--force-with-lease',
        '-u',
        ctx.cfg.github.remote,
        `HEAD:refs/heads/${l.branch}`,
      ],
      l.worktree,
    );
    if (!forced.ok) {
      event(ctx, 'push-fail', { plan: l.id, detail: forced.stderr });
      return 'env';
    }
  }
  let pr = ctx.gh.findPRByBranch(l.branch);
  if (!pr || pr.state !== 'open') {
    const idx = ref.kind === 'multi' ? readIndex(l.worktree, findPlan(l.worktree, l.id)!) : null;
    const entry = idx?.steps[l.step ?? 0];
    const close = completed.last ? `Closes #${l.issue}` : `Refs #${l.issue}`;
    const body = `${close}

- 계획: \`${l.id}\`${l.step === null ? '' : ` step ${l.step}${entry ? ` (${entry.name})` : ''}`}
- 요약: ${entry?.summary ?? '(계획 파일 참조)'}
- 판정: runner가 AC ${acs.length}개와 \`check\`를 직접 실행해 통과했다.
- 자체 리뷰: scripts/cross-review/checklist.md (2단계부터 CI 교차 검증)

🤖 harness runner (${ctx.o.worker}, ${ctx.o.tool})`;
    pr = ctx.gh.createPR({
      head: l.branch,
      base: ctx.cfg.github.defaultBranch,
      title: `${String(l.fm.type ?? 'feat')}(${l.id}): ${entry ? `step${entry.step} ${entry.name}` : '작업'}`,
      body,
    });
  }
  ctx.gh.enableAutoMerge(pr.number);
  if (existsSync(answerFile)) unlinkSync(answerFile);
  event(ctx, 'pr-ready', { plan: l.id, step: l.step, pr: pr.number, last: completed.last });
  return 'ok';
}

// ---------- 그 밖의 할 일 ----------

async function doAnswered(ctx: Ctx, t: Extract<Pick['task'], { kind: 'answered' }>): Promise<void> {
  ctx.gh.removeLabel(t.issue, ctx.cfg.github.needsHumanLabel);
  if (t.local) {
    const info = repoInfo(t.local.worktree);
    writeFileSync(path.join(harnessStateDir(info, 'worktree'), 'answer.md'), t.answer);
    recordAttempt(info, {
      plan: t.local.id,
      step: t.local.step,
      key: RESET_KEY,
      ok: true,
      kind: 'plan',
      detail: '제작자 답변으로 실패 횟수 초기화',
    });
    setPlanStatus(t.local.worktree, 'active', `제작자 답변 받음(#${t.issue})`);
    if (t.local.ref.kind === 'multi') {
      setStepStatus(t.local.worktree, 'in_progress');
    }
  }
  event(ctx, 'answered', { issue: t.issue });
}

async function doRebase(ctx: Ctx, l: LocalPlan): Promise<void> {
  const target = `${ctx.cfg.github.remote}/${ctx.cfg.github.defaultBranch}`;
  const r = gitTry(['rebase', '--quiet', target], l.worktree);
  const info = repoInfo(l.worktree);
  if (!r.ok) {
    gitTry(['rebase', '--abort'], l.worktree);
    recordAttempt(info, {
      plan: l.id,
      step: l.step,
      key: 'pr:rebase-conflict',
      ok: false,
      kind: 'pr',
      detail: tail(r.stderr, 20),
    });
    // 1단계: 충돌 해결 세션은 아직 없다. 사람에게 넘긴다(2단계에서 자동 대응)
    await blockPlan(ctx, l, `main과 충돌해 자동 rebase를 할 수 없다: ${tail(r.stderr, 3)}`);
    return;
  }
  gitTry(
    ['push', '--quiet', '--force-with-lease', ctx.cfg.github.remote, `HEAD:refs/heads/${l.branch}`],
    l.worktree,
  );
  recordAttempt(info, {
    plan: l.id,
    step: l.step,
    key: 'pr:rebase-conflict',
    ok: true,
    kind: 'pr',
  });
  event(ctx, 'rebased', { plan: l.id, pr: l.pr?.number });
}

async function doFixPR(
  ctx: Ctx,
  l: LocalPlan,
  failing: string[],
): Promise<'ok' | 'fail' | 'env' | 'blocked'> {
  const info = repoInfo(l.worktree);
  recordAttempt(info, {
    plan: l.id,
    step: l.step,
    key: `pr:checks`,
    ok: false,
    kind: 'pr',
    detail: `CI 실패 체크: ${failing.join(', ')}`,
  });
  reopenStep(l.worktree, `CI 체크 실패: ${failing.join(', ')}`);
  const fresh = { ...l, ref: findPlan(l.worktree, l.id) ?? l.ref };
  return doStep(
    ctx,
    fresh,
    `## CI 실패\nPR의 필수 체크가 실패했다: ${failing.join(', ')}. 로컬에서 \`node scripts/harness.ts check\`로 재현해 고쳐라.`,
  );
}

/** 병합된 브랜치의 깨끗한 worktree를 정리한다(7.1절 세션 시작 절차 ②) */
export function cleanupMerged(main: string, cfg: HarnessConfig, locals: LocalPlan[]): string[] {
  const removed: string[] = [];
  for (const l of locals) {
    if (l.pr?.state !== 'merged') continue;
    if (!isClean(l.worktree)) continue;
    // 마지막 step이 병합됐으면 선점도 푼다(10.3절 절차 5)
    if (l.ref.where === 'completed' && l.issue > 0) releaseClaim(main, cfg, l.issue);
    const r = gitTry(['worktree', 'remove', l.worktree], main);
    if (r.ok) {
      gitTry(['branch', '-D', l.branch], main);
      removed.push(l.worktree);
    }
  }
  gitTry(['worktree', 'prune'], main);
  return removed;
}

// ---------- 메인 루프 ----------

export async function runRunner(o: RunnerOptions): Promise<StopReason> {
  const info = repoInfo(o.cwd);
  const main = repoInfo(info.mainRoot);
  const cfg = loadConfig(main.mainRoot);
  const gh = getGitHub(main.mainRoot);
  const ctx: Ctx = {
    o,
    main,
    cfg,
    gh,
    logFile: path.join(harnessStateDir(main, 'common'), 'runner.jsonl'),
    envWaitMs: 0,
  };
  // 에이전트 CLI를 셸 없이 띄울 수 있는지 먼저 확인한다(Windows의 .cmd 래퍼, ADR-0005).
  // 설정 문제이므로 실패 횟수에 넣지 않고 시작하지 않는다.
  const agent = resolveAgentCommand(o.tool, cfg);
  if ('error' in agent) {
    warn(`runner를 시작하지 않는다: ${agent.error}`);
    return 'agent-missing';
  }
  const lock = acquireLock(main, o.worker);
  if (!lock) {
    warn(`작업자 ${o.worker}의 runner가 이미 실행 중이다`);
    return 'locked';
  }
  const started = Date.now();
  const pollMs = (o.pollSec ?? cfg.limits.pollSec) * 1000;
  let iterations = 0;
  let errors = 0;
  let stop: StopReason = 'idle';
  event(ctx, 'start', { tool: o.tool });
  try {
    for (;;) {
      if (Date.now() - started > cfg.limits.runnerMaxHours * 3_600_000) {
        stop = 'time-limit';
        break;
      }
      if (o.maxIterations && iterations >= o.maxIterations) {
        stop = 'max-iterations';
        break;
      }
      iterations++;
      fetchRemote(main.mainRoot, cfg);
      syncMain(ctx);
      const pick = pickNext({ main: main.mainRoot, cfg, gh, worker: o.worker });
      event(ctx, 'pick', { kind: pick.task.kind, reason: pick.reason });
      let outcome: string = 'ok';
      const t = pick.task;
      try {
        switch (t.kind) {
          case 'answered':
            await doAnswered(ctx, t);
            break;
          case 'fix-pr':
            outcome = await doFixPR(ctx, t.local, t.pr.failingChecks);
            break;
          case 'rebase':
            await doRebase(ctx, t.local);
            break;
          case 'plan':
            outcome = await doPlanning(ctx, t.local);
            break;
          case 'step':
            outcome = await doStep(ctx, t.local);
            break;
          case 'next-step': {
            const r = await newTask(main.mainRoot, { plan: t.id, step: t.step, github: false });
            event(ctx, 'next-step', { plan: t.id, step: t.step, worktree: r.worktree });
            break;
          }
          case 'new-issue': {
            const labels = t.issue.labels;
            const size = labels.includes('size:small')
              ? 'small'
              : labels.includes('size:large')
                ? 'large'
                : 'medium';
            const risk = labels.includes('risk:high')
              ? 'high'
              : labels.includes('risk:low')
                ? 'low'
                : undefined;
            const type = labels.includes('bug') ? 'fix' : labels.includes('docs') ? 'docs' : 'feat';
            try {
              const r = await newTask(main.mainRoot, {
                issue: t.issue.number,
                slug: slugFor(t.issue.title, t.issue.number),
                type,
                size,
                risk,
                owner: o.worker,
                author: o.tool === 'codex' ? 'codex' : 'claude-code',
                title: t.issue.title,
              });
              event(ctx, 'claimed', { issue: t.issue.number, plan: r.id, worktree: r.worktree });
            } catch (e) {
              if (e instanceof ClaimError)
                event(ctx, 'claim-lost', { issue: t.issue.number, reason: e.message });
              else throw e;
            }
            break;
          }
          case 'idle': {
            const removed = cleanupMerged(
              main.mainRoot,
              cfg,
              readLocalPlans({ main: main.mainRoot, cfg, gh, worker: o.worker }),
            );
            if (removed.length) {
              event(ctx, 'cleanup', { removed: removed.length });
              continue;
            }
            if (pick.waiting.ci > 0 && !o.noWait) {
              event(ctx, 'wait-ci', { reason: pick.reason });
              await sleep(pollMs);
              continue;
            }
            stop = pick.waiting.human > 0 ? 'human' : 'idle';
            event(ctx, 'stop', { reason: pick.reason });
            return stop;
          }
        }
      } catch (e) {
        event(ctx, 'error', { kind: t.kind, detail: (e as Error).stack ?? String(e) });
        outcome = 'error';
      }
      errors = outcome === 'error' ? errors + 1 : 0;
      if (errors >= 3) {
        stop = 'error';
        break;
      }
      if (outcome === 'env') {
        // 환경 장애는 실패로 세지 않고 기다렸다가 다시 시도한다(4.5절)
        ctx.envWaitMs += pollMs;
        if (ctx.envWaitMs > cfg.limits.usageLimitMaxWaitMin * 60_000) {
          stop = 'usage-limit';
          break;
        }
        event(ctx, 'wait-env', { reason: `${Math.round(ctx.envWaitMs / 60000)}분 대기 중` });
        if (!o.noWait) await sleep(pollMs);
      } else ctx.envWaitMs = 0;
      if (o.once) {
        stop = 'once';
        break;
      }
    }
  } finally {
    event(ctx, 'exit', { reason: stop });
    try {
      rmSync(lock);
    } catch {
      // 무시
    }
  }
  return stop;
}
