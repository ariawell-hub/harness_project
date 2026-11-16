// revert 워크플로(10.3절 "병합 후 main CI가 실패하면"). main의 `check`가 실패로 끝났을 때
// 무엇을 할지 정하고(decideRevert) 그 일을 한다(actRevert).
//   plan job: 읽기 권한만으로 조회해 정한다(planRevert). 비밀이 없다.
//   act job : `revert` environment의 봇 토큰으로 재실행, revert/<SHA> 브랜치 push·PR·자동 병합, Issue 재오픈·댓글.
// 되돌리기는 `git revert` 커밋의 PR로만 한다. main에 직접 push하지 않고(R2) 이력을 고쳐 쓰지 않는다(R14).
// revert PR도 필수 체크를 거친다: `revert-check`가 정확한 역적용과 대상의 main check 실패를 확인한다.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { gitTry, revParse, showFile } from '../lib/git.ts';
import type { GitHubPort } from '../lib/github.ts';
import { findPlanAt, parseBranch, parseDoc } from '../lib/plan.ts';
import { revertMarker } from '../lib/revert-marker.ts';
import { globToRegExp } from '../lib/util.ts';
import { cell } from './ledger.ts';
import { SHA_RE } from './results.ts';

export type RevertAction =
  | { action: 'skip'; reason: string }
  | { action: 'rerun'; runId: number }
  | {
      action: 'escalate';
      reason: string;
      issue: number | null;
      pr: number | null;
      /** 실패한 main 커밋(같은 대상의 알림을 한 번만 달기 위한 표식에 쓴다) */
      target: string;
    }
  | {
      action: 'revert';
      target: string;
      pr: number;
      issue: number | null;
      closes: boolean;
      title: string;
    };

export interface RevertRun {
  id: number;
  headSha: string;
  attempt: number;
  conclusion: string;
  event: string;
  branch: string;
}

export interface RevertSource {
  number: number;
  headRef: string;
  title: string;
  body: string;
}

export class RevertError extends Error {}

const TITLE_MAX = 200;
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const firstLine = (s: string) => oneLine(s.trim().split('\n')[0] ?? '').slice(0, 200);
const isId = (n: unknown): n is number => Number.isInteger(n) && (n as number) > 0;

/** PR 본문 첫 줄의 `Closes #N`·`Refs #N` */
function issueRef(body: string): { issue: number | null; closes: boolean } {
  const m = /^(closes|refs) #([1-9]\d*)\b/i.exec(body.split('\n')[0].trim());
  return m
    ? { issue: Number(m[2]), closes: m[1].toLowerCase() === 'closes' }
    : { issue: null, closes: false };
}

/** 무엇을 할지 정한다(순수 함수. 조회 결과는 인자로 받는다) */
export function decideRevert(o: {
  run: RevertRun;
  defaultBranch: string;
  /** 대상이 main의 first-parent 이력에 있는가 */
  onMain: boolean;
  /** 대상 커밋을 병합한 PR. 없으면 null */
  source: RevertSource | null;
  /** revert/<대상> 브랜치나 그 PR이 이미 있는가 */
  exists: boolean;
  /** 되돌려도 복구되지 않는 변경인가(계획 risk: high, 경로 표의 높음 경로) */
  irreversible: boolean;
}): RevertAction {
  const { run } = o;
  const skip = (reason: string): RevertAction => ({ action: 'skip', reason });
  if (run.event !== 'push') return skip('push 이벤트의 실행이 아니다');
  if (run.branch !== o.defaultBranch) return skip('기본 브랜치의 실행이 아니다');
  if (run.conclusion !== 'failure' && run.conclusion !== 'timed_out')
    return skip('실행의 결론이 실패가 아니다');
  if (!SHA_RE.test(run.headSha) || !o.onMain)
    return skip('대상 커밋이 main의 first-parent 이력에 없다');
  // 첫 실패는 흔들리는 테스트나 시간 의존일 수 있다: 한 번 다시 실행한다
  if (run.attempt <= 1) return { action: 'rerun', runId: run.id };
  if (o.exists) return skip('revert 브랜치나 PR이 이미 있다');
  const target = run.headSha;
  if (!o.source)
    return {
      action: 'escalate',
      reason: '대상 커밋을 병합한 PR을 찾지 못했다',
      issue: null,
      pr: null,
      target,
    };
  const { issue, closes } = issueRef(o.source.body);
  const escalate = (reason: string): RevertAction => ({
    action: 'escalate',
    reason,
    issue,
    pr: o.source!.number,
    target,
  });
  if (o.source.headRef.startsWith('revert/'))
    return escalate(
      'revert PR의 병합 커밋이 실패했다. revert를 다시 자동으로 되돌리지 않는다(실패 원인이 대상이 아닐 수 있다)',
    );
  if (o.irreversible)
    return escalate(
      '되돌려도 복구되지 않을 수 있는 변경이다(계획 risk: high 또는 경로 표의 높음 경로). 원인과 영향 범위를 확인해야 한다',
    );
  return {
    action: 'revert',
    target,
    pr: o.source.number,
    issue,
    closes,
    title: oneLine(o.source.title).slice(0, TITLE_MAX),
  };
}

/** 받은 값(plan job의 출력)을 다시 검사해 RevertAction으로 읽는다. 형식이 다르면 예외 */
export function parseRevertAction(raw: unknown): RevertAction {
  const a = (raw ?? {}) as Record<string, unknown>;
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max && !/[\r\n]/.test(v);
  const idOrNull = (v: unknown) => v === null || isId(v);
  const sha = (v: unknown) => typeof v === 'string' && SHA_RE.test(v);
  if (a.action === 'skip' && text(a.reason, 500))
    return { action: 'skip', reason: a.reason as string };
  if (a.action === 'rerun' && isId(a.runId)) return { action: 'rerun', runId: a.runId };
  if (
    a.action === 'escalate' &&
    text(a.reason, 500) &&
    idOrNull(a.issue) &&
    idOrNull(a.pr) &&
    sha(a.target)
  )
    return {
      action: 'escalate',
      reason: a.reason as string,
      issue: a.issue as number | null,
      pr: a.pr as number | null,
      target: a.target as string,
    };
  if (
    a.action === 'revert' &&
    sha(a.target) &&
    isId(a.pr) &&
    idOrNull(a.issue) &&
    typeof a.closes === 'boolean' &&
    text(a.title, TITLE_MAX)
  )
    return {
      action: 'revert',
      target: a.target as string,
      pr: a.pr,
      issue: a.issue as number | null,
      closes: a.closes,
      title: a.title as string,
    };
  throw new RevertError('revert 동작 자료의 형식이 다르다');
}

// ---------- 조회 (plan job) ----------

/** `workflow_run` 이벤트에서 실행 정보를 읽는다. 형식이 다르면 null */
export function runOf(event: unknown): RevertRun | null {
  const w = (event as { workflow_run?: Record<string, unknown> } | null)?.workflow_run;
  if (
    !w ||
    !isId(w.id) ||
    !isId(w.run_attempt) ||
    typeof w.head_sha !== 'string' ||
    typeof w.event !== 'string'
  )
    return null;
  return {
    id: w.id,
    headSha: w.head_sha,
    attempt: w.run_attempt,
    conclusion: typeof w.conclusion === 'string' ? w.conclusion : '',
    event: w.event,
    branch: typeof w.head_branch === 'string' ? w.head_branch : '',
  };
}

function onHistory(root: string, ref: string, sha: string): boolean {
  const r = gitTry(['rev-list', '--first-parent', ref], root);
  return r.ok && r.stdout.split('\n').includes(sha);
}

interface RawPr {
  number?: unknown;
  title?: unknown;
  body?: unknown;
  merged_at?: unknown;
  merge_commit_sha?: unknown;
  head?: { ref?: unknown };
  base?: { ref?: unknown };
}

/** 그 커밋을 기본 브랜치에 병합한 PR. 없으면 null. 조회 실패는 예외다(없다고 단정하지 않는다) */
export async function sourcePrOf(
  api: (path: string) => Promise<unknown>,
  repo: string,
  sha: string,
  defaultBranch: string,
): Promise<RevertSource | null> {
  const list = await api(`repos/${repo}/commits/${sha}/pulls?per_page=100`);
  if (!Array.isArray(list)) throw new RevertError('PR 조회 응답이 배열이 아니다');
  for (const p of list as RawPr[]) {
    if (
      p?.merge_commit_sha === sha &&
      typeof p.merged_at === 'string' &&
      p.base?.ref === defaultBranch &&
      isId(p.number) &&
      typeof p.head?.ref === 'string' &&
      typeof p.title === 'string'
    )
      return {
        number: p.number,
        headRef: p.head.ref,
        title: p.title,
        body: typeof p.body === 'string' ? p.body : '',
      };
  }
  return null;
}

/**
 * 되돌려도 복구되지 않는 변경인가: 대상 커밋 트리의 계획(브랜치 이름으로 찾는다)이 `risk: high`이거나,
 * 대상이 바꾼 파일이 경로 표(`riskPaths`)의 높음 항목에 걸린다. 보호 경로의 단계별 위험도는 넣지 않는다.
 * 바꾼 파일을 읽지 못하면 참이다(모르면 자동으로 되돌리지 않는다)
 */
export function irreversible(
  root: string,
  cfg: HarnessConfig,
  target: string,
  headRef: string,
): boolean {
  const b = parseBranch(headRef);
  if (b) {
    const read = (f: string) => showFile(root, target, f);
    const ref = findPlanAt(read, b.id);
    if (ref && parseDoc(read(ref.file) ?? '').frontmatter?.risk === 'high') return true;
  }
  const diff = gitTry(['diff', '--name-only', '--no-renames', '-z', `${target}^`, target], root);
  if (!diff.ok) return true;
  const high = cfg.riskPaths.filter((r) => r.risk === 'high').map((r) => globToRegExp(r.glob));
  return diff.stdout
    .split('\0')
    .filter(Boolean)
    .some((f) => high.some((re) => re.test(f)));
}

/** 이벤트와 조회 결과로 할 일을 정한다. git은 root(기본 브랜치 체크아웃, 전체 이력)에서 읽기만 한다 */
export async function planRevert(o: {
  root: string;
  cfg: HarnessConfig;
  /** owner/name */
  repo: string;
  /** GitHub REST GET(경로는 `repos/...`) */
  api: (path: string) => Promise<unknown>;
  event: unknown;
}): Promise<RevertAction> {
  const run = runOf(o.event);
  if (!run) return { action: 'skip', reason: 'workflow_run 이벤트의 형식이 다르다' };
  const { remote, defaultBranch } = o.cfg.github;
  const sha = run.headSha;
  const onMain = SHA_RE.test(sha) && onHistory(o.root, `${remote}/${defaultBranch}`, sha);
  // 아래 조회는 결과가 결정에 쓰일 때만 한다(실패한 main 실행의 두 번째 시도부터)
  const failed =
    run.event === 'push' &&
    run.branch === defaultBranch &&
    (run.conclusion === 'failure' || run.conclusion === 'timed_out');
  const lookup = failed && onMain && run.attempt > 1;
  let source: RevertSource | null = null;
  let exists = false;
  let irr = false;
  if (lookup) {
    const branch = `revert/${sha}`;
    const prs = await o.api(
      `repos/${o.repo}/pulls?head=${o.repo.split('/')[0]}:${branch}&state=all&per_page=1`,
    );
    if (!Array.isArray(prs)) throw new RevertError('revert PR 조회 응답이 배열이 아니다');
    exists = prs.length > 0 || revParse(`${remote}/${branch}`, o.root) !== null;
    source = await sourcePrOf(o.api, o.repo, sha, defaultBranch);
    irr = source ? irreversible(o.root, o.cfg, sha, source.headRef) : false;
  }
  return decideRevert({ run, defaultBranch, onMain, source, exists, irreversible: irr });
}

// ---------- 실행 (act job) ----------

const ESCALATE_MARK = (target: string) => `<!-- harness-revert-escalate target=${target} -->`;

function escalate(
  o: ActOptions,
  e: { reason: string; issue: number | null; pr: number | null; target: string },
): { done: string } {
  const n = e.issue ?? e.pr;
  // 알릴 곳이 없으면 실행을 실패로 끝내 Actions 알림으로 드러낸다
  if (n === null)
    throw new RevertError(`자동으로 되돌리지 않았고 알릴 Issue·PR이 없다: ${e.reason}`);
  const mark = ESCALATE_MARK(e.target);
  const last = o.gh.comments(n).at(-1);
  if (last && last.author.toLowerCase() === o.gh.me().toLowerCase() && last.body.includes(mark))
    return { done: `에스컬레이션: #${n}에 이미 알렸다` };
  const owner = o.cfg.github.owner;
  o.gh.comment(
    n,
    [
      `${owner ? `@${owner} ` : ''}main의 \`check\`가 다시 실행한 뒤에도 실패했다. 자동으로 되돌리지 않았다(설계서 10.3절).`,
      '',
      `- 실패한 커밋: \`${e.target}\``,
      `- 되돌리지 않은 이유: ${cell(e.reason)}`,
      `- 실패한 실행: ${o.runUrl}`,
      '',
      '원인을 확인하고 되돌릴지, 고쳐서 올릴지 정해야 한다.',
      mark,
    ].join('\n'),
  );
  o.gh.addLabel(n, o.cfg.github.needsHumanLabel);
  return { done: `에스컬레이션: #${n}에 알렸다 — ${e.reason}` };
}

function doRevert(o: ActOptions, a: Extract<RevertAction, { action: 'revert' }>): { done: string } {
  const { remote, defaultBranch } = o.cfg.github;
  const base = `${remote}/${defaultBranch}`;
  const branch = `revert/${a.target}`;
  if (!onHistory(o.root, base, a.target))
    throw new RevertError(`대상 ${a.target.slice(0, 12)}이 ${base}의 first-parent 이력에 없다`);
  const listed = gitTry(['ls-remote', '--heads', remote, branch], o.root);
  if (!listed.ok)
    throw new RevertError(`원격 브랜치를 조회하지 못했다: ${firstLine(listed.stderr)}`);
  if (listed.stdout.trim() !== '' || o.gh.findPRByBranch(branch))
    return { done: `아무것도 하지 않는다: ${branch} 브랜치나 PR이 이미 있다` };
  const esc = (reason: string) =>
    escalate(o, { reason, issue: a.issue, pr: a.pr, target: a.target });

  // main 체크아웃은 건드리지 않는다: 임시 worktree에서 되돌린다
  const wt = path.join(mkdtempSync(path.join(tmpdir(), 'harness-revert-')), 'wt');
  const added = gitTry(['worktree', 'add', '--quiet', '--detach', wt, base], o.root);
  if (!added.ok) throw new RevertError(`임시 worktree를 만들지 못했다: ${firstLine(added.stderr)}`);
  try {
    const bot = o.cfg.github.bot || 'harness-bot';
    const identity = [
      '-c',
      `user.name=${bot}`,
      '-c',
      `user.email=${bot}@users.noreply.github.com`,
      '-c',
      'commit.gpgsign=false',
    ];
    const reverted = gitTry([...identity, 'revert', '--no-edit', a.target], wt);
    if (!reverted.ok) {
      gitTry(['revert', '--abort'], wt);
      return esc(`git revert가 충돌했다: ${firstLine(reverted.stderr || reverted.stdout)}`);
    }
    // 일반 push다. 같은 이름의 브랜치가 생겼거나 권한이 없으면(워크플로 파일 변경 등) 거부된다
    const pushed = gitTry(['push', '--quiet', remote, `HEAD:refs/heads/${branch}`], wt);
    if (!pushed.ok) return esc(`revert 브랜치 push가 거부됐다: ${firstLine(pushed.stderr)}`);
  } finally {
    gitTry(['worktree', 'remove', wt], o.root);
  }

  const source = o.gh.getPR(a.pr);
  const plan = source ? parseBranch(source.head) : null;
  let pr: number;
  try {
    const created = o.gh.createPR({
      head: branch,
      base: defaultBranch,
      title: `revert: ${a.title}`.slice(0, TITLE_MAX),
      body: [
        ...(a.issue ? [`Refs #${a.issue}`, ''] : []),
        'main의 `check`가 다시 실행한 뒤에도 실패해 병합 커밋을 되돌린다(설계서 10.3절).',
        '',
        `- 대상 커밋: \`${a.target}\``,
        `- 원래 PR: #${a.pr}`,
        `- 실패한 실행: ${o.runUrl}`,
        '',
        '`revert-check`가 "대상 커밋의 정확한 역적용"과 "대상의 main `check` 실패"를 확인하면 LLM 검증 없이 병합된다.',
      ].join('\n'),
    });
    pr = created.number;
    o.gh.enableAutoMerge(pr);
  } catch (e) {
    return esc(
      `revert 브랜치(${branch})는 올렸지만 PR 생성이나 자동 병합 설정이 실패했다: ${firstLine((e as Error).message)}`,
    );
  }

  if (a.issue !== null && a.closes) o.gh.reopenIssue(a.issue);
  // 이어 가는 명령: 대상의 부모에 계획이 없으면 첫 PR이 되돌려진 것이라 계획을 복원한다(8.3절)
  const inParent =
    plan !== null && findPlanAt((f) => showFile(o.root, `${a.target}^`, f), plan.id) !== null;
  const next = !plan
    ? null
    : !inParent
      ? a.issue !== null
        ? `node scripts/harness.ts new-task --issue ${a.issue}`
        : null
      : `node scripts/harness.ts new-task --plan ${plan.id} --step ${plan.step ?? 0}`;
  o.gh.comment(
    a.issue ?? a.pr,
    [
      'main의 `check`가 다시 실행한 뒤에도 실패해 이 작업의 병합을 되돌린다.',
      '',
      `- 되돌리는 커밋: \`${a.target}\` (PR #${a.pr} ${cell(a.title)})`,
      `- 실패한 실행: ${o.runUrl}`,
      `- revert PR: #${pr}`,
      next
        ? `- 이어 가기: revert PR이 병합된 뒤 \`${next}\``
        : '- 이어 가기: 원래 계획을 찾지 못했다. revert PR이 병합된 뒤 새 작업으로 시작한다',
      ...(plan ? [revertMarker(a.target, plan.id)] : []),
    ].join('\n'),
  );
  return { done: `revert PR #${pr}을 만들고 자동 병합을 켰다(대상 ${a.target.slice(0, 12)})` };
}

export interface ActOptions {
  /** 기본 브랜치 체크아웃(전체 이력, 원격 push 인증이 설정돼 있다) */
  root: string;
  gh: GitHubPort;
  cfg: HarnessConfig;
  /** 실패한 실행의 URL(댓글·PR 본문에 적는다) */
  runUrl: string;
}

/** 정한 일을 한다. git은 main 체크아웃에서, GitHub은 포트로 */
export function actRevert(o: ActOptions, a: RevertAction): { done: string } {
  switch (a.action) {
    case 'skip':
      return { done: `아무것도 하지 않는다: ${a.reason}` };
    case 'rerun':
      o.gh.rerunFailed(a.runId);
      return { done: `실패한 job을 다시 실행했다(실행 ${a.runId})` };
    case 'escalate':
      return escalate(o, a);
    case 'revert':
      return doRevert(o, a);
  }
}
