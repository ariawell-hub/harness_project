// 작업 시작과 계획 완료 처리 (4.1절 ①②, 8.1절, 8.3절).
//   new-task       : claim/<issue> 선점 → 브랜치 + worktree + 계획 골격 → setup
//   new-task --plan: 다음 step의 브랜치·worktree
//   (계획 복원)    : revert로 main에서 빠진 계획을 new-task --issue가 되살린다(restorePlan)
//   claim-heartbeat: claim 브랜치에 빈 커밋(생존 확인)
//   (start ②)      : 닫힌 Issue의 claim/<N> 해제(releaseClosedClaims)
//   complete-step  : 계획 전용 커밋(step completed, 마지막 step이면 completed/로 이동)
//   reopen-step    : 완료 커밋 뒤 다시 고쳐야 할 때 step을 in_progress로 되돌림
import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveConfigPath, type HarnessConfig } from '../lib/config.ts';
import { getGitHub, type GitHubPort, type Issue } from '../lib/github.ts';
import { git, gitTry, repoInfo, revParse, showFile, type RepoInfo } from '../lib/git.ts';
import {
  PLANS_DIR,
  PLAN_ID_RE,
  branchName,
  findPlan,
  findPlanAt,
  parseBranch,
  parseDoc,
  parseIndex,
  readIndex,
  setFrontmatter,
  unhandledFindings,
  writeIndex,
  type PlanRef,
} from '../lib/plan.ts';
import { findRevertMarker } from '../lib/revert-marker.ts';
import { log, nowIso, warn } from '../lib/util.ts';
import { runStandard } from './standard.ts';

export class TaskError extends Error {}
export class ClaimError extends TaskError {}

function baseRef(cfg: HarnessConfig): string {
  return `${cfg.github.remote}/${cfg.github.defaultBranch}`;
}

/** commit-tree 등에 쓸 커밋 신원. 설정이 없으면 하네스 기본값 */
function identityEnv(cwd: string): NodeJS.ProcessEnv {
  const name = gitTry(['config', 'user.name'], cwd).stdout.trim();
  const email = gitTry(['config', 'user.email'], cwd).stdout.trim();
  if (name && email) return {};
  return {
    GIT_AUTHOR_NAME: name || 'harness-agent',
    GIT_AUTHOR_EMAIL: email || 'harness-agent@users.noreply.github.com',
    GIT_COMMITTER_NAME: name || 'harness-agent',
    GIT_COMMITTER_EMAIL: email || 'harness-agent@users.noreply.github.com',
  };
}

export function fetchRemote(main: string, cfg: HarnessConfig): void {
  const r = gitTry(['fetch', '--prune', '--quiet', cfg.github.remote], main);
  if (!r.ok)
    throw new TaskError(
      `원격(${cfg.github.remote}) fetch 실패: ${r.stderr.trim()}\n고치는 법: 원격 리포 설정(0단계)과 봇 토큰을 확인하라`,
    );
}

// ---------- 선점 (8.3절) ----------

export function claimIssue(main: string, cfg: HarnessConfig, issue: number, owner: string): void {
  const ref = baseRef(cfg);
  const tree = git(['rev-parse', `${ref}^{tree}`], main);
  const parent = git(['rev-parse', ref], main);
  const sha = git(
    ['commit-tree', tree, '-p', parent, '-m', `claim #${issue} by ${owner} at ${nowIso()}`],
    main,
    identityEnv(main),
  );
  // 원격에 같은 이름이 있으면 non-fast-forward로 거부된다 → 한 작업자만 선점
  const r = gitTry(
    ['push', '--quiet', cfg.github.remote, `${sha}:refs/heads/claim/${issue}`],
    main,
  );
  if (!r.ok) {
    throw new ClaimError(
      `Issue #${issue}는 이미 선점되어 있다(claim/${issue} push 거부): ${r.stderr.trim().split('\n')[0]}`,
    );
  }
}

export function claimHeartbeat(
  main: string,
  cfg: HarnessConfig,
  issue: number,
  owner: string,
): void {
  const remote = cfg.github.remote;
  gitTry(['fetch', '--quiet', remote, `claim/${issue}`], main);
  const tip = revParse(`${remote}/claim/${issue}`, main) ?? revParse('FETCH_HEAD', main);
  if (!tip) throw new TaskError(`claim/${issue} 브랜치가 원격에 없다`);
  const tree = git(['rev-parse', `${tip}^{tree}`], main);
  const sha = git(
    ['commit-tree', tree, '-p', tip, '-m', `heartbeat #${issue} by ${owner} at ${nowIso()}`],
    main,
    identityEnv(main),
  );
  const r = gitTry(['push', '--quiet', remote, `${sha}:refs/heads/claim/${issue}`], main);
  if (!r.ok) throw new TaskError(`claim/${issue} 생존 확인 push 실패: ${r.stderr.trim()}`);
}

/**
 * `claim/<issue>`를 선점한 작업자. 선점이 없으면 null, 커밋 메시지에서 읽지 못하면 ''.
 * 원격 추적 브랜치를 읽는다: 부르기 전에 `fetchRemote`(prune)를 해 둔다
 */
export function claimOwner(main: string, cfg: HarnessConfig, issue: number): string | null {
  const tip = revParse(`${cfg.github.remote}/claim/${issue}`, main);
  if (!tip) return null;
  const subject = git(['log', '-1', '--format=%s', tip], main);
  return /^(?:claim|heartbeat) #\d+ by (.+) at \S+$/.exec(subject)?.[1] ?? '';
}

const CLAIM_REF_RE = /^refs\/heads\/claim\/([1-9]\d*)$/;

/** 원격의 claim/<숫자> 브랜치 번호(오름차순). 조회 실패는 TaskError */
export function listRemoteClaims(main: string, cfg: HarnessConfig): number[] {
  const r = gitTry(['ls-remote', '--heads', cfg.github.remote, 'claim/*'], main);
  if (!r.ok)
    throw new TaskError(
      `원격(${cfg.github.remote}) claim 목록 조회 실패: ${firstLine(r.stderr) || `종료 코드 ${r.code}`}`,
    );
  // `claim/*` 패턴은 꼬리 일치라 feat/claim/5·claim/1/x도 온다. 정확히 claim/<숫자>만 남긴다
  const nums = new Set<number>();
  for (const line of r.stdout.split('\n')) {
    const m = CLAIM_REF_RE.exec(line.split('\t')[1]?.trim() ?? '');
    if (m) nums.add(Number(m[1]));
  }
  return [...nums].sort((a, b) => a - b);
}

function deleteClaim(main: string, cfg: HarnessConfig, issue: number) {
  return gitTry(['push', '--quiet', cfg.github.remote, '--delete', `claim/${issue}`], main);
}

/** 원격 claim/<issue>를 지운다. 성공하면 true */
export function releaseClaim(main: string, cfg: HarnessConfig, issue: number): boolean {
  return deleteClaim(main, cfg, issue).ok;
}

export interface ClaimCleanup {
  released: number[];
  kept: number[];
  failed: { issue: number; reason: string }[];
}

/**
 * 닫힌 Issue의 claim 브랜치를 원격에서 지운다(세션 시작 절차 ②, 8.3절).
 * 기준은 로컬 worktree가 아니라 GitHub Issue 상태다(마지막 step PR의 `Closes #N`으로 닫힌다).
 * `openIssues`에 있으면 다시 묻지 않고 남긴다. 닫혔음을 확인하지 못하면(조회 실패, 없는 번호) 지우지 않는다.
 * 목록 조회 실패는 TaskError. 멱등이다.
 */
export function releaseClosedClaims(
  main: string,
  cfg: HarnessConfig,
  gh: GitHubPort,
  openIssues: Issue[],
): ClaimCleanup {
  const open = new Set(openIssues.map((i) => i.number));
  const out: ClaimCleanup = { released: [], kept: [], failed: [] };
  for (const n of listRemoteClaims(main, cfg)) {
    if (open.has(n)) {
      out.kept.push(n);
      continue;
    }
    let state: Issue['state'];
    try {
      state = gh.getIssue(n).state;
    } catch (e) {
      out.failed.push({ issue: n, reason: `Issue 조회 실패: ${firstLine((e as Error).message)}` });
      continue;
    }
    if (state !== 'closed') {
      out.kept.push(n);
      continue;
    }
    const r = deleteClaim(main, cfg, n);
    if (r.ok) out.released.push(n);
    else
      out.failed.push({
        issue: n,
        reason: `삭제 실패: ${firstLine(r.stderr) || `종료 코드 ${r.code}`}`,
      });
  }
  return out;
}

function firstLine(s: string): string {
  return s.trim().split('\n')[0] ?? '';
}

// ---------- new-task ----------

export interface NewTaskOptions {
  issue?: number;
  slug?: string;
  type?: string;
  size?: 'small' | 'medium' | 'large';
  risk?: 'low' | 'normal' | 'high';
  owner?: string;
  author?: string;
  title?: string;
  date?: string;
  plan?: string;
  step?: number;
  claim?: boolean;
  setup?: boolean;
  github?: boolean;
}

export interface NewTaskResult {
  id: string;
  branch: string;
  worktree: string;
  planFile: string;
  step: number | null;
}

export function worktreePath(main: string, cfg: HarnessConfig, branch: string): string {
  return path.join(resolveConfigPath(cfg.paths.worktreeRoot, main), ...branch.split('/'));
}

export interface LinkOps {
  symlink: (src: string, dst: string) => void;
  hardlink: (src: string, dst: string) => void;
}

/**
 * 파일을 연결한다: 심볼릭 링크 → 실패하면 하드 링크(14.2절, ADR-0005).
 * Windows는 개발자 모드·관리자 권한 없이 심볼릭 링크를 못 만들지만, 같은 볼륨이면 하드 링크는 된다.
 * 복사하지 않는다: 키를 교체해도 복사본이 남기 때문이다.
 */
export function linkFile(
  src: string,
  dst: string,
  ops: LinkOps = { symlink: (s, d) => symlinkSync(s, d), hardlink: (s, d) => linkSync(s, d) },
): 'symlink' | 'hardlink' | null {
  try {
    ops.symlink(src, dst);
    return 'symlink';
  } catch {
    // 아래 하드 링크로 대신한다
  }
  try {
    ops.hardlink(src, dst);
    return 'hardlink';
  } catch {
    return null;
  }
}

function linkDevEnv(main: string, cfg: HarnessConfig, wt: string): void {
  const src = resolveConfigPath(cfg.paths.devEnvFile, main);
  const dst = path.join(wt, '.env');
  if (!existsSync(src) || existsSync(dst)) return;
  const how = linkFile(src, dst);
  if (how === 'hardlink') {
    log('개발용 .env: 심볼릭 링크 권한이 없어 하드 링크로 연결했다');
  } else if (how === null) {
    warn(
      '개발용 .env 연결 실패(무시): 심볼릭 링크·하드 링크 모두 안 된다. ' +
        'Windows는 개발자 모드를 켜거나, worktree와 개발용 .env를 같은 드라이브에 두라(14.2절)',
    );
  }
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .split('-')
    .slice(0, 5)
    .join('-');
}

export function slugFor(title: string, issue: number): string {
  const s = slugify(title);
  return s && !/-s\d+$/.test(s) ? s : `issue-${issue}`;
}

function localDate(): string {
  return nowIso().slice(0, 10).replaceAll('-', '');
}

export async function newTask(cwd: string, o: NewTaskOptions): Promise<NewTaskResult> {
  const info = repoInfo(cwd);
  const main = info.mainRoot;
  const cfg = loadConfig(main);
  fetchRemote(main, cfg);
  const ref = baseRef(cfg);
  if (!revParse(ref, main))
    throw new TaskError(`${ref}가 없다. 원격에 기본 브랜치를 먼저 push하라(0단계)`);
  const readBase = (f: string) => showFile(main, ref, f);

  // 다음 step
  if (o.plan) {
    const id = o.plan;
    const pref = findPlanAt(readBase, id);
    if (!pref || pref.kind !== 'multi' || pref.where !== 'active') {
      throw new TaskError(
        `${ref}에 진행 중인 step 계획 ${id}가 없다. 앞 step이 병합되었는지 확인하라`,
      );
    }
    const step = o.step ?? 0;
    const idx = parseIndex(readBase(`${pref.dir}/index.json`)!);
    if (!idx.steps[step]) throw new TaskError(`${id}에 step${step}이 없다`);
    for (let i = 0; i < step; i++) {
      if (idx.steps[i].status !== 'completed')
        throw new TaskError(
          `앞 step${i}이 아직 병합되지 않았다(4.5절: 다음 step은 앞 step 병합 뒤)`,
        );
    }
    const fm = parseDoc(readBase(pref.file)!).frontmatter ?? {};
    const type = o.type ?? (typeof fm.type === 'string' ? fm.type : 'feat');
    const branch = branchName(type, id, step);
    const wt = worktreePath(main, cfg, branch);
    // 닫혔다 다시 열린 Issue(마지막 step의 PR이 revert됨)는 선점이 풀려 있다: 다시 선점한다(8.3절)
    const planIssue = Number(fm.issue ?? 0);
    if (
      o.claim !== false &&
      o.github !== false &&
      planIssue > 0 &&
      claimOwner(main, cfg, planIssue) === null
    ) {
      let open = false;
      try {
        open = safeGitHub(main)?.getIssue(planIssue).state === 'open';
      } catch (e) {
        warn(`Issue #${planIssue} 상태 조회 실패(선점하지 않고 진행): ${(e as Error).message}`);
      }
      if (open)
        claimIssue(main, cfg, planIssue, o.owner ?? process.env.HARNESS_WORKER ?? 'session');
    }
    git(['worktree', 'add', '--quiet', '-b', branch, wt, ref], main);
    linkDevEnv(main, cfg, wt);
    if (o.setup !== false) await setupWorktree(wt);
    return { id, branch, worktree: wt, planFile: pref.file, step };
  }

  // 첫 step: 선점 → 계획 골격
  if (!o.issue || o.issue <= 0)
    throw new TaskError('--issue <번호>가 필요하다(작업은 GitHub Issue로 접수한다, 14.6절)');
  const gh = o.github === false ? null : safeGitHub(main);
  const owner = o.owner ?? process.env.HARNESS_WORKER ?? 'session';

  // revert로 main에서 빠진 계획이면 새 골격 대신 그 계획을 복원한다(8.3절 "되돌리기")
  const restore = gh ? findRestore(main, cfg, gh, o.issue) : null;
  if (restore) {
    const { req, plan } = restore;
    const branch = branchName(plan.type, req.planId, plan.step);
    const wt = worktreePath(main, cfg, branch);
    if (existsSync(wt))
      throw new TaskError(
        `worktree 경로가 이미 있다: ${wt}\n고치는 법: revert 전의 병합된 worktree면 main 체크아웃에서 start로 정리한 뒤 다시 실행하라`,
      );
    if (o.claim !== false) {
      // revert된 첫 step의 Issue는 닫힌 적이 없어 내 선점이 남아 있을 수 있다: 내 것이면 그대로 쓴다
      const cur = claimOwner(main, cfg, o.issue);
      if (cur === null) claimIssue(main, cfg, o.issue, owner);
      else if (cur !== owner)
        throw new ClaimError(
          `Issue #${o.issue}는 이미 선점되어 있다(claim/${o.issue}, 작업자 ${cur || '불명'})`,
        );
    }
    git(['worktree', 'add', '--quiet', '-b', branch, wt, ref], main);
    const pref = writeRestored(wt, req, plan, owner);
    if (o.slug || o.size || o.risk)
      log('복원한 계획의 id·규모·위험도를 쓴다: --slug·--size·--risk는 무시했다');
    linkDevEnv(main, cfg, wt);
    if (o.setup !== false) await setupWorktree(wt);
    try {
      gh!.comment(
        o.issue,
        `담당: \`${owner}\` — revert된 계획 \`${req.planId}\` 복원(대상 ${req.target.slice(0, 12)}), 브랜치 \`${branch}\` (claim/${o.issue})`,
      );
    } catch (e) {
      warn(`Issue 댓글 실패(무시): ${(e as Error).message}`);
    }
    return { id: req.planId, branch, worktree: wt, planFile: pref.file, step: plan.step };
  }

  if (!o.slug) throw new TaskError('--slug <짧은-이름>이 필요하다');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.slug) || /-s\d+$/.test(o.slug)) {
    throw new TaskError(`slug(${o.slug})는 kebab-case여야 하고 -s<숫자>로 끝나면 안 된다`);
  }
  const id = `${o.date ?? localDate()}-${o.slug}`;
  if (!PLAN_ID_RE.test(id)) throw new TaskError(`계획 id 형식 오류: ${id}`);
  if (findPlanAt(readBase, id)) throw new TaskError(`계획 ${id}가 이미 있다`);
  const size = o.size ?? 'medium';
  const type = o.type ?? 'feat';
  const step = size === 'small' ? null : 0;
  const branch = branchName(type, id, step);
  const wt = worktreePath(main, cfg, branch);
  if (existsSync(wt)) throw new TaskError(`worktree 경로가 이미 있다: ${wt}`);

  let title = o.title;
  if (!title && gh) {
    try {
      title = gh.getIssue(o.issue).title;
    } catch (e) {
      warn(`Issue 제목 조회 실패(무시): ${(e as Error).message}`);
    }
  }
  if (o.claim !== false) claimIssue(main, cfg, o.issue, owner);

  git(['worktree', 'add', '--quiet', '-b', branch, wt, ref], main);
  const planFile = writeSkeleton(wt, {
    id,
    issue: o.issue,
    type,
    size,
    risk: o.risk ?? (size === 'small' ? 'low' : 'normal'),
    author: o.author ?? 'claude-code',
    owner,
    title: title ?? `Issue #${o.issue}`,
  });
  linkDevEnv(main, cfg, wt);
  if (o.setup !== false) await setupWorktree(wt);
  if (gh) {
    try {
      gh.comment(
        o.issue,
        `담당: \`${owner}\` — 계획 \`${id}\`, 브랜치 \`${branch}\` (claim/${o.issue})`,
      );
    } catch (e) {
      warn(`Issue 댓글 실패(무시): ${(e as Error).message}`);
    }
  }
  return { id, branch, worktree: wt, planFile, step };
}

function safeGitHub(cwd: string) {
  try {
    return getGitHub(cwd);
  } catch (e) {
    warn(`GitHub 연결 없음(무시): ${(e as Error).message}`);
    return null;
  }
}

async function setupWorktree(wt: string): Promise<void> {
  const cfg = loadConfig(wt);
  const r = await runStandard('setup', wt, cfg, { stream: false });
  if (!r.ok) {
    throw new TaskError(
      `worktree setup 실패: ${r.result ? (r.result.stderr || r.result.stdout).slice(-2000) : ''}`,
    );
  }
}

interface SkeletonFields {
  id: string;
  issue: number;
  type: string;
  size: string;
  risk: string;
  author: string;
  owner: string;
  title: string;
}

export function writeSkeleton(wt: string, f: SkeletonFields): string {
  const small = f.size === 'small';
  const tpl = path.join(wt, PLANS_DIR, small ? 'TEMPLATE-small.md' : 'TEMPLATE.md');
  if (!existsSync(tpl)) throw new TaskError(`계획 템플릿이 없다: ${tpl}`);
  let text = readFileSync(tpl, 'utf8');
  const values: Record<string, string | number> = {
    id: f.id,
    issue: f.issue,
    type: f.type,
    status: 'draft',
    size: f.size,
    risk: f.risk,
    author: f.author,
    owner: f.owner,
    claimed_at: nowIso(),
  };
  for (const [k, v] of Object.entries(values)) text = setFrontmatter(text, k, v);
  text = text.replace(/^# .*$/m, `# ${f.title}`);
  let rel: string;
  if (small) {
    rel = `${PLANS_DIR}/active/${f.id}.md`;
    mkdirSync(path.dirname(path.join(wt, rel)), { recursive: true });
    writeFileSync(path.join(wt, rel), text);
  } else {
    const dir = `${PLANS_DIR}/active/${f.id}`;
    mkdirSync(path.join(wt, dir), { recursive: true });
    rel = `${dir}/plan.md`;
    writeFileSync(path.join(wt, rel), text);
    writeFileSync(
      path.join(wt, dir, 'index.json'),
      JSON.stringify({ plan: f.id, steps: [] }, null, 2) + '\n',
    );
  }
  return rel;
}

// ---------- revert된 계획의 복원 (8.3절 "되돌리기") ----------

export interface RestoreRequest {
  /** revert된 커밋(40자 SHA) */
  target: string;
  planId: string;
  issue: number;
}

export interface RestorablePlan {
  /** 대상 커밋에서 계획이 있던 자리 */
  from: PlanRef;
  type: string;
  /** 되돌려진 step(그 커밋에서 완료된 step 가운데 첫 번째). 소규모 계획은 null */
  step: number | null;
  /** 그 커밋에서 완료된 step 전부 */
  reverted: number[];
}

const SHA_RE = /^[0-9a-f]{40}$/;

/**
 * 복원할 수 있는 계획인가(읽기만 한다). 아래를 모두 만족해야 하고, 하나라도 아니면 null이다.
 *  - `m.target`이 40자 SHA이고 `base`(원격 기본 브랜치)의 조상이다. 표식은 외부 입력이라 형식부터 본다(14.6절)
 *  - `m.target` 트리에 계획 `m.planId`가 있고 frontmatter의 `issue`가 `m.issue`다
 *  - `base`에는 그 계획이 없다(revert로 빠졌다)
 * 대상 커밋보다 옛 이력에서는 찾지 않는다: 표식이 가리키는 커밋의 계획만이 되돌려진 계획이다
 */
export function restorablePlan(
  cwd: string,
  base: string,
  m: RestoreRequest,
): RestorablePlan | null {
  if (!SHA_RE.test(m.target) || !PLAN_ID_RE.test(m.planId)) return null;
  if (!gitTry(['merge-base', '--is-ancestor', m.target, base], cwd).ok) return null;
  const at = (rev: string) => (f: string) => showFile(cwd, rev, f);
  const from = findPlanAt(at(m.target), m.planId);
  if (!from) return null;
  const fm = parseDoc(showFile(cwd, m.target, from.file)!).frontmatter ?? {};
  if (Number(fm.issue) !== m.issue) return null;
  if (findPlanAt(at(base), m.planId)) return null;
  const type = typeof fm.type === 'string' ? fm.type : 'feat';
  if (from.kind === 'small') return { from, type, step: null, reverted: [] };
  // 그 커밋에서 completed가 된 step: 부모 커밋의 계획과 비교한다(계획이 그 커밋에서 처음 들어왔으면 부모에는 없다)
  const parent = `${m.target}^`;
  const before = findPlanAt(at(parent), m.planId);
  const beforeIdx = before?.dir ? showFile(cwd, parent, `${before.dir}/index.json`) : null;
  const done = new Set(
    beforeIdx
      ? parseIndex(beforeIdx)
          .steps.filter((s) => s.status === 'completed')
          .map((s) => s.step)
      : [],
  );
  const idxText = showFile(cwd, m.target, `${from.dir}/index.json`);
  if (!idxText) return null;
  const reverted = parseIndex(idxText)
    .steps.filter((s) => s.status === 'completed' && !done.has(s.step))
    .map((s) => s.step);
  if (!reverted.length) return null;
  return { from, type, step: reverted[0], reverted };
}

/** 대상 커밋의 계획을 `active/`에 쓰고 되돌려진 step을 `pending`으로 둔다. 핵심 섹션과 step 파일은 그대로다 */
function writeRestored(wt: string, m: RestoreRequest, p: RestorablePlan, owner: string): PlanRef {
  const src = p.from.kind === 'multi' ? `${p.from.dir}/` : p.from.file;
  const files = git(['ls-tree', '-r', '--name-only', '-z', m.target, '--', src], wt)
    .split('\0')
    .filter(Boolean);
  const toActive = (f: string) =>
    f.replace(`${PLANS_DIR}/${p.from.where}/`, `${PLANS_DIR}/active/`);
  for (const f of files) {
    const dst = path.join(wt, toActive(f));
    mkdirSync(path.dirname(dst), { recursive: true });
    writeFileSync(dst, showFile(wt, m.target, f)!);
  }
  const ref: PlanRef = {
    ...p.from,
    where: 'active',
    file: toActive(p.from.file),
    ...(p.from.dir ? { dir: toActive(p.from.dir) } : {}),
  };
  const planFile = path.join(wt, ref.file);
  let text = readFileSync(planFile, 'utf8');
  text = setFrontmatter(text, 'status', 'active');
  text = setFrontmatter(text, 'owner', owner);
  writeFileSync(planFile, text);
  if (ref.kind === 'multi') {
    const idx = readIndex(wt, ref);
    for (const s of idx.steps) {
      if (!p.reverted.includes(s.step)) continue;
      s.status = 'pending';
      delete s.completed_at;
      delete s.summary;
    }
    writeIndex(wt, ref, idx);
  }
  appendProgress(wt, ref, `revert된 계획 복원: 대상 ${m.target.slice(0, 12)}`);
  return ref;
}

/**
 * revert로 main에서 빠진 계획을 worktree `wt`의 `active/`에 복원한다(8.3절). 복원할 수 없으면 null이고 아무것도 쓰지 않는다.
 * 계획의 "목표와 수용 기준"·"범위 / 비범위"·"관련 파일·문서"와 step 파일의 "작업"·"Acceptance Criteria"·"금지사항"은
 * 바꾸지 않는다: 계획 해시가 같아 이미 받은 계획 승인이 유지된다(10.3절)
 */
export function restorePlan(
  wt: string,
  base: string,
  m: RestoreRequest,
  owner: string = process.env.HARNESS_WORKER ?? 'session',
): PlanRef | null {
  const p = restorablePlan(wt, base, m);
  return p ? writeRestored(wt, m, p, owner) : null;
}

/** Issue 댓글의 revert 표식(봇 계정의 것만)이 가리키는 계획이 복원할 수 있는 상태면 그 요청을 돌려준다 */
export function findRestore(
  main: string,
  cfg: HarnessConfig,
  gh: GitHubPort,
  issue: number,
): { req: RestoreRequest; plan: RestorablePlan } | null {
  let marker: ReturnType<typeof findRevertMarker>;
  try {
    marker = findRevertMarker(gh.comments(issue), cfg.github.bot);
  } catch (e) {
    warn(`Issue #${issue}의 revert 표식 조회 실패(새 골격으로 진행): ${(e as Error).message}`);
    return null;
  }
  if (!marker) return null;
  const req = { ...marker, issue };
  const plan = restorablePlan(main, baseRef(cfg), req);
  return plan ? { req, plan } : null;
}

// ---------- 계획 전용 커밋 (8.3절) ----------

function planOf(info: RepoInfo): { ref: PlanRef; step: number | null; id: string } {
  const b = parseBranch(info.branch);
  if (!b) throw new TaskError(`브랜치 ${info.branch}가 계획 브랜치가 아니다`);
  const ref = findPlan(info.root, b.id);
  if (!ref) throw new TaskError(`계획 ${b.id}를 찾을 수 없다`);
  return { ref, step: b.step, id: b.id };
}

function updatePlanStatus(root: string, ref: PlanRef, status: string): void {
  const f = path.join(root, ref.file);
  writeFileSync(f, setFrontmatter(readFileSync(f, 'utf8'), 'status', status));
}

function movePlan(root: string, ref: PlanRef, to: 'active' | 'completed'): void {
  const src = ref.kind === 'multi' ? ref.dir! : ref.file;
  const dst = src.replace(`${PLANS_DIR}/${ref.where}/`, `${PLANS_DIR}/${to}/`);
  mkdirSync(path.dirname(path.join(root, dst)), { recursive: true });
  git(['mv', src, dst], root);
}

function commitPlan(root: string, message: string): string {
  git(['add', '-A', '--', PLANS_DIR], root);
  const staged = gitTry(['diff', '--cached', '--quiet', '--', PLANS_DIR], root);
  if (staged.ok) return git(['rev-parse', 'HEAD'], root);
  git(['commit', '--quiet', '-m', message, '--', PLANS_DIR], root, identityEnv(root));
  return git(['rev-parse', 'HEAD'], root);
}

export interface CompleteResult {
  id: string;
  step: number | null;
  last: boolean;
  commit: string;
}

export function completeStep(cwd: string): CompleteResult {
  const info = repoInfo(cwd);
  const { ref, step, id } = planOf(info);
  if (ref.where !== 'active') throw new TaskError(`계획 ${id}가 이미 completed/에 있다`);
  const text = readFileSync(path.join(info.root, ref.file), 'utf8');
  const bad = unhandledFindings(parseDoc(text).body);
  if (bad.length) {
    throw new TaskError(
      `발견 사항에 처리가 없다(${bad.length}건):\n- ${bad.join('\n- ')}\n고치는 법: 항목 끝에 "→ 처리: [문서](경로) | #Issue | TD-N | 해당 없음"을 적어라`,
    );
  }
  let last = true;
  if (ref.kind === 'multi') {
    const idx = readIndex(info.root, ref);
    const entry = idx.steps[step ?? 0];
    if (!entry) throw new TaskError(`index.json에 step${step}이 없다`);
    entry.status = 'completed';
    entry.completed_at = nowIso();
    writeIndex(info.root, ref, idx);
    last = idx.steps.every((s) => s.status === 'completed');
  }
  if (last) {
    updatePlanStatus(info.root, ref, 'completed');
    movePlan(info.root, ref, 'completed');
  } else if (parseDoc(text).frontmatter?.status === 'draft') {
    updatePlanStatus(info.root, ref, 'active');
  }
  const label = step === null ? '완료' : `step${step} 완료`;
  const commit = commitPlan(info.root, `plan(${id}): ${label}`);
  return { id, step, last, commit };
}

export function reopenStep(cwd: string, reason: string): void {
  const info = repoInfo(cwd);
  let { ref, step, id } = planOf(info);
  if (ref.where === 'completed') {
    movePlan(info.root, ref, 'active');
    ref = findPlan(info.root, id)!;
  }
  updatePlanStatus(info.root, ref, 'active');
  if (ref.kind === 'multi') {
    const idx = readIndex(info.root, ref);
    const entry = idx.steps[step ?? 0];
    if (entry) {
      entry.status = 'in_progress';
      delete entry.completed_at;
    }
    writeIndex(info.root, ref, idx);
  }
  appendProgress(info.root, ref, `step${step ?? ''} 재작업: ${reason}`);
  commitPlan(info.root, `plan(${id}): step${step ?? ''} 재작업`);
}

/**
 * 글의 끝이 빈 줄 없이 붙여 쓴 `-` 목록인가. 그 목록에는 새 항목을 바로 아래에 잇는다.
 * 끝의 목록은 끝에서부터 빈 줄·들여 쓴 줄·`- `로 시작하는 줄이 이어진 곳이다. 그 안에 빈 줄이 하나라도 있으면
 * (항목 사이를 띄운 목록, 항목 안의 딸린 문단) 붙여 쓴 목록이 아니다: 포매터가 새 항목 앞에 빈 줄을 넣는 꼴이 있다.
 * 번호 목록·코드 블록·표·인용·문단으로 끝나는 글도 아니다
 */
function endsWithTightList(body: string): boolean {
  const lines = body.split('\n');
  let k = lines.length;
  while (
    k > 0 &&
    (/^\s*$/.test(lines[k - 1]) || /^\s/.test(lines[k - 1]) || lines[k - 1].startsWith('- '))
  )
    k--;
  while (k < lines.length && /^\s*$/.test(lines[k])) k++;
  const block = lines.slice(k);
  return block.length > 0 && block[0].startsWith('- ') && !block.some((l) => /^\s*$/.test(l));
}

/**
 * 진행 로그에 한 줄 추가 (소규모 계획은 섹션이 없으면 만든다).
 * 포매터의 결과와 같게 쓴다: 붙여 쓴 목록의 끝에는 바로 아래에 잇고, 그 밖에는(빈 줄이 든 목록, 제목·주석·문단·
 * 코드 블록 뒤) 빈 줄을 두며, 파일의 끝은 줄바꿈 하나다.
 */
export function appendProgress(root: string, ref: PlanRef, line: string): void {
  const f = path.join(root, ref.file);
  let text = readFileSync(f, 'utf8');
  const entry = `- ${nowIso()} ${line}`;
  const m = /^## 진행 로그.*$/m.exec(text);
  if (m) {
    const start = m.index + m[0].length;
    const next = text.slice(start).search(/^## /m);
    const end = next < 0 ? text.length : start + next;
    const body = text.slice(start, end).replace(/\s+$/, '');
    const inList = endsWithTightList(body);
    const rest = text.slice(end);
    text =
      text.slice(0, start) +
      body +
      (inList ? '\n' : '\n\n') +
      entry +
      (rest ? '\n\n' + rest : '\n');
  } else {
    text = text.replace(/\s*$/, '') + `\n\n## 진행 로그\n\n${entry}\n`;
  }
  writeFileSync(f, text);
}

export function setPlanStatus(cwd: string, status: string, note?: string): void {
  const info = repoInfo(cwd);
  const { ref, id } = planOf(info);
  updatePlanStatus(info.root, ref, status);
  if (note) appendProgress(info.root, ref, note);
  commitPlan(info.root, `plan(${id}): ${status}`);
}

export function setStepStatus(cwd: string, status: 'in_progress' | 'pending' | 'blocked'): void {
  const info = repoInfo(cwd);
  const { ref, step } = planOf(info);
  if (ref.kind !== 'multi') return;
  const idx = readIndex(info.root, ref);
  const entry = idx.steps[step ?? 0];
  if (!entry || entry.status === status) return;
  entry.status = status;
  if (status === 'in_progress') entry.started_at ??= nowIso();
  writeIndex(info.root, ref, idx);
}
