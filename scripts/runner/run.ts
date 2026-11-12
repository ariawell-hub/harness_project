// runner (4.5절). 할 일이 남아 있는 한 step마다 새 세션을 띄우고, AC·check로 직접 판정한다.
// 골격은 jha0313/harness_framework의 execute.py(step마다 새 세션, summary 누적, 에러를 넣은 재시도)를 따른다.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
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
  remoteBranchDiverged,
  repoInfo,
  updateBranchFromBase,
  type RepoInfo,
} from '../lib/git.ts';
import {
  acceptanceCommands,
  findPlan,
  openQuestions,
  parseDoc,
  readIndex,
  section,
  type OpenQuestion,
  type PlanRef,
} from '../lib/plan.ts';
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
import { resolveAgentCommand, runSession, type AgentTool, type SessionResult } from './agents.ts';
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

/**
 * 세션 원본 출력을 공유 git-dir의 harness/sessions/에 남기고 session-end 이벤트를 쓴다(Issue #16).
 * 무인 세션이 왜 멈췄는지(권한 거부, 종료 이유)를 나중에 볼 수 있게 한다. 기록 실패는 작업을 막지 않는다.
 */
function recordSession(
  ctx: Ctx,
  l: LocalPlan,
  kind: 'planning' | 'step',
  attempt: number,
  s: SessionResult,
): void {
  let file: string | undefined;
  try {
    const dir = path.join(harnessStateDir(ctx.main, 'common'), 'sessions');
    mkdirSync(dir, { recursive: true });
    const stamp = nowIso().replace(/[:+]/g, '-');
    const part = kind === 'planning' ? 'plan' : `s${l.step ?? 0}`;
    // 환경 장애 재시도는 시도 번호가 같고 같은 초에 끝날 수 있다. 덮어쓰지 않게 번호를 붙인다
    const base = path.join(dir, `${stamp}-${l.id}-${part}-${attempt}`);
    file = `${base}.log`;
    for (let i = 2; existsSync(file); i++) file = `${base}-${i}.log`;
    writeFileSync(file, s.raw, { flag: 'wx' });
  } catch (e) {
    warn(`세션 출력 저장 실패: ${(e as Error).message}`);
  }
  const sum = s.summary;
  const tools = [...new Set((sum?.denials ?? []).map((d) => d.tool))];
  event(ctx, 'session-end', {
    plan: l.id,
    step: l.step,
    kind,
    attempt,
    code: s.code,
    timedOut: s.timedOut,
    durationMs: s.durationMs,
    sessionId: sum?.sessionId,
    turns: sum?.numTurns,
    terminalReason: sum?.terminalReason,
    denials: sum?.denials.length ?? 0,
    deniedTools: tools,
    log: file,
    ...(tools.length ? { reason: `권한 거부 ${sum!.denials.length}건: ${tools.join(', ')}` } : {}),
  });
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

// ---------- 열린 질문 (TD-18) ----------

/** 올린 질문 제목과 답 대기 여부. worktree 하네스 상태 폴더의 questions.json(answer.md 옆) */
interface QuestionState {
  reported: string[];
  waiting: boolean;
}

function questionFile(info: RepoInfo): string {
  return path.join(harnessStateDir(info, 'worktree'), 'questions.json');
}

function readQuestionState(info: RepoInfo): QuestionState {
  try {
    const raw = JSON.parse(readFileSync(questionFile(info), 'utf8')) as Partial<QuestionState>;
    return {
      reported: Array.isArray(raw.reported) ? raw.reported.map(String) : [],
      waiting: raw.waiting === true,
    };
  } catch {
    return { reported: [], waiting: false };
  }
}

function writeQuestionState(info: RepoInfo, s: QuestionState): void {
  writeFileSync(questionFile(info), JSON.stringify(s, null, 2) + '\n');
}

/** 계획을 멈추고(blocked, push) Issue에 needs-human + 제작자 멘션으로 질문을 올린다(9.1절) */
async function askQuestions(
  ctx: Ctx,
  l: LocalPlan,
  ref: PlanRef,
  fresh: OpenQuestion[],
  prev: QuestionState,
): Promise<void> {
  const info = repoInfo(l.worktree);
  setPlanStatus(
    l.worktree,
    'blocked',
    `열린 질문 ${fresh.length}건: 제작자 답변 대기(#${l.issue})`,
  );
  const push = gitTry(['push', '--quiet', '-u', ctx.cfg.github.remote, l.branch], l.worktree);
  if (!push.ok) warn(`계획 브랜치 push 실패(질문은 올린다): ${tail(push.stderr, 3)}`);
  writeQuestionState(info, {
    reported: [...prev.reported, ...fresh.map((q) => q.title)],
    waiting: true,
  });
  const mention = ctx.cfg.github.owner ? `@${ctx.cfg.github.owner} ` : '';
  const body = `${mention}runner의 계획 작성 세션이 질문 ${fresh.length}건을 남겼다. 답을 받을 때까지 계획 \`${l.id}\`를 멈춘다.

- 계획: \`${ref.file}\` (브랜치 \`${l.branch}\`)
- 답하는 법: 이 Issue에 제작자 계정으로 댓글을 단다. runner가 답을 넣어 계획을 다시 작성하고 이어 간다.

${fresh.map((q) => q.text).join('\n\n')}`;
  try {
    ctx.gh.addLabel(l.issue, ctx.cfg.github.needsHumanLabel);
    ctx.gh.comment(l.issue, body);
  } catch (e) {
    warn(`GitHub 알림 실패: ${(e as Error).message}`);
  }
  event(ctx, 'questions', {
    plan: l.id,
    reason: `열린 질문 ${fresh.length}건: ${fresh.map((q) => q.title).join(' / ')}`,
  });
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
  const answerFile = path.join(harnessStateDir(info, 'worktree'), 'answer.md');
  const answer = existsSync(answerFile) ? readFileSync(answerFile, 'utf8') : undefined;
  const prompt = planningPrompt(l.worktree, l.ref, l.id, issue, all, n, answer);
  event(ctx, 'session-start', { plan: l.id, kind: 'planning', attempt: n });
  const s = await runSession(
    ctx.o.tool,
    prompt,
    l.worktree,
    ctx.main,
    ctx.cfg,
    ctx.cfg.limits.sessionTimeoutMin * 60_000,
  );
  recordSession(ctx, l, 'planning', n, s);
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
  // 열린 질문(TD-18): 새 질문이 있으면 Issue에 올리고 답을 받을 때까지 이 계획을 멈춘다
  const questions = openQuestions(parseDoc(text).body);
  const qs = readQuestionState(info);
  const fresh = questions.filter((q) => !qs.reported.includes(q.title));
  if (fresh.length) {
    await askQuestions(ctx, l, ref, fresh, qs);
    return 'ok';
  }
  if (questions.length)
    event(ctx, 'questions-kept', {
      plan: l.id,
      reason: `이미 올려 답을 받은 질문 ${questions.length}건이 열린 질문에 남아 있다`,
    });
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
  recordSession(ctx, l, 'step', sessions + 1, s);
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
    // runner도 force push하지 않는다(14.4절, ADR-0006). 원격과 갈라졌으면 어느 쪽을 남길지 사람이 판단한다
    if (remoteBranchDiverged(l.worktree, ctx.cfg.github.remote, l.branch)) {
      recordAttempt(info, {
        plan: l.id,
        step: l.step,
        key: 'pr:push',
        ok: false,
        kind: 'pr',
        detail: tail(push.stderr, 5),
      });
      await blockPlan(
        ctx,
        l,
        `원격 브랜치 ${l.branch}에 로컬에 없는 커밋이 있어 push가 거부됐다. 덮어쓰지 않는다(R14). 절차서 5절대로 원격 이력을 확인해 병합하거나 정리한다`,
      );
      return 'blocked';
    }
    event(ctx, 'push-fail', { plan: l.id, detail: push.stderr });
    return 'env';
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
    const qs = readQuestionState(info);
    if (qs.waiting) {
      // 계획 작성 단계의 질문(TD-18): 답을 넣어 계획을 다시 작성한다. step 상태는 그대로 둔다
      writeQuestionState(info, { ...qs, waiting: false });
      setPlanStatus(t.local.worktree, 'draft', `제작자 답변 받음(#${t.issue}): 계획에 반영한다`);
      event(ctx, 'answered', { issue: t.issue, replan: true });
      return;
    }
    setPlanStatus(t.local.worktree, 'active', `제작자 답변 받음(#${t.issue})`);
    if (t.local.ref.kind === 'multi') {
      setStepStatus(t.local.worktree, 'in_progress');
    }
  }
  event(ctx, 'answered', { issue: t.issue });
}

/** main에 뒤처지거나 충돌한 PR을 origin/main 병합 + 일반 push로 갱신한다(ADR-0006). force push는 없다 */
async function doUpdate(ctx: Ctx, l: LocalPlan): Promise<'ok' | 'env'> {
  const { remote, defaultBranch } = ctx.cfg.github;
  const r = updateBranchFromBase(l.worktree, remote, defaultBranch, l.branch);
  const info = repoInfo(l.worktree);
  const record = (ok: boolean, detail?: string) =>
    recordAttempt(info, { plan: l.id, step: l.step, key: 'pr:update', ok, kind: 'pr', detail });
  if (r.status === 'updated') {
    record(true);
    event(ctx, 'updated', { plan: l.id, pr: l.pr?.number, from: r.from, to: r.to });
    return 'ok';
  }
  if (r.status === 'up-to-date') {
    // GitHub의 병합 상태 계산이 늦은 것이다. 실패로 세지 않고 환경 대기로 넘긴다(바로 다시 고르면 헛돈다)
    event(ctx, 'update-noop', { plan: l.id, pr: l.pr?.number, head: r.head });
    return 'env';
  }
  if (r.status === 'conflict') {
    record(false, `main 병합 충돌: ${r.files.join(', ')}`);
    // 1단계: 충돌 해결 세션은 아직 없다. 사람에게 넘긴다(2단계에서 자동 대응, TD-9)
    await blockPlan(
      ctx,
      l,
      `${remote}/${defaultBranch} 병합이 충돌한다(${r.files.join(', ')}). 병합은 취소했다. 절차서 5절대로 worktree에서 병합해 충돌을 풀고 일반 push한다`,
    );
    return 'ok';
  }
  record(false, `PR 갱신 실패(${r.stage}): ${r.reason}`);
  event(ctx, 'update-fail', { plan: l.id, pr: l.pr?.number, stage: r.stage, reason: r.reason });
  const v = judge(readAttempts(info), l.id, l.step, limitsOf(ctx.cfg));
  if (v.action === 'stop') await blockPlan(ctx, l, v.reason ?? `PR 갱신 반복 실패: ${r.reason}`);
  return 'ok';
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

/** 심볼릭 링크(macOS /var → /private/var)를 풀어 child가 parent 안(같거나 하위)인지 본다 */
function insideDir(child: string, parent: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  const rel = path.relative(real(parent), real(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * 병합된 브랜치의 깨끗한 worktree를 정리한다(7.1절 세션 시작 절차 ②).
 * `here`(기본: 이 프로세스의 현재 폴더)가 들어 있는 worktree는 지우지 않는다.
 * 지우면 그 안에서 `start`를 부른 세션의 현재 폴더가 사라져 이후 명령이 모두 실패한다(Issue #16).
 */
export function cleanupMerged(
  main: string,
  cfg: HarnessConfig,
  locals: LocalPlan[],
  here: string = process.cwd(),
): string[] {
  const removed: string[] = [];
  for (const l of locals) {
    if (l.pr?.state !== 'merged') continue;
    if (!isClean(l.worktree)) continue;
    if (insideDir(here, l.worktree)) {
      log(
        `- 남김: ${l.worktree} — 지금 이 프로세스가 그 worktree 안에서 실행 중이다. ` +
          'main 체크아웃으로 나간 뒤(ExitWorktree 또는 cd) start를 다시 실행하면 정리된다',
      );
      continue;
    }
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
          case 'update':
            outcome = await doUpdate(ctx, t.local);
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
