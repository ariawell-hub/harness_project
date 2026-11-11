// 작업 시작과 계획 완료 처리 (4.1절 ①②, 8.1절, 8.3절).
//   new-task       : claim/<issue> 선점 → 브랜치 + worktree + 계획 골격 → setup
//   new-task --plan: 다음 step의 브랜치·worktree
//   claim-heartbeat: claim 브랜치에 빈 커밋(생존 확인)
//   complete-step  : 계획 전용 커밋(step completed, 마지막 step이면 completed/로 이동)
//   reopen-step    : 완료 커밋 뒤 다시 고쳐야 할 때 step을 in_progress로 되돌림
import { existsSync, linkSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, resolveConfigPath, type HarnessConfig } from '../lib/config.ts';
import { getGitHub } from '../lib/github.ts';
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

export function releaseClaim(main: string, cfg: HarnessConfig, issue: number): void {
  gitTry(['push', '--quiet', cfg.github.remote, '--delete', `claim/${issue}`], main);
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
    git(['worktree', 'add', '--quiet', '-b', branch, wt, ref], main);
    linkDevEnv(main, cfg, wt);
    if (o.setup !== false) await setupWorktree(wt);
    return { id, branch, worktree: wt, planFile: pref.file, step };
  }

  // 첫 step: 선점 → 계획 골격
  if (!o.issue || o.issue <= 0)
    throw new TaskError('--issue <번호>가 필요하다(작업은 GitHub Issue로 접수한다, 14.6절)');
  if (!o.slug) throw new TaskError('--slug <짧은-이름>이 필요하다');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(o.slug) || /-s\d+$/.test(o.slug)) {
    throw new TaskError(`slug(${o.slug})는 kebab-case여야 하고 -s<숫자>로 끝나면 안 된다`);
  }
  const id = `${o.date ?? localDate()}-${o.slug}`;
  if (!PLAN_ID_RE.test(id)) throw new TaskError(`계획 id 형식 오류: ${id}`);
  if (findPlanAt(readBase, id)) throw new TaskError(`계획 ${id}가 이미 있다`);
  const size = o.size ?? 'medium';
  const type = o.type ?? 'feat';
  const owner = o.owner ?? process.env.HARNESS_WORKER ?? 'session';
  const step = size === 'small' ? null : 0;
  const branch = branchName(type, id, step);
  const wt = worktreePath(main, cfg, branch);
  if (existsSync(wt)) throw new TaskError(`worktree 경로가 이미 있다: ${wt}`);

  let title = o.title;
  const gh = o.github === false ? null : safeGitHub(main);
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

/** 진행 로그에 한 줄 추가 (소규모 계획은 섹션이 없으면 만든다) */
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
    text = text.slice(0, start) + body + '\n' + entry + '\n\n' + text.slice(end);
  } else {
    text = text.replace(/\s*$/, '') + `\n\n## 진행 로그\n${entry}\n`;
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
