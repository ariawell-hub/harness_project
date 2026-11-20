// `pr-state`: PR의 필수 체크 상태를 출처와 함께 보여 주고 분류한다(10.3절). 읽기만 한다.
// PR 화면의 체크 요약과 `gh pr checks`는 출처를 보지 않는다. 병합을 막는 것이 무엇인지는 이 명령으로 본다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { worktreeOfBranch } from '../lib/approval.ts';
import { loadConfig, type HarnessConfig } from '../lib/config.ts';
import { gitTry, isBehind, repoInfo, showFile } from '../lib/git.ts';
import { getGitHub, type GitHubPort, type PullRequest } from '../lib/github.ts';
import { findPlan, findPlanAt, parseBranch, parseDoc, parseIndex, readIndex } from '../lib/plan.ts';
import { log } from '../lib/util.ts';
import { readPrLedger } from '../runner/ledger-read.ts';
import { classifyPr, describeVerdict, requiredStates } from '../runner/pr-state.ts';
import { longOpen } from '../runner/review.ts';

/**
 * 커밋 `rev`의 트리에서 그 브랜치가 맡은 step이 completed인가. 커밋이나 계획을 읽지 못하면 null.
 * PR 분류는 PR head의 상태로 한다: 수정하다 실패해 step을 되돌린 커밋이 로컬에만 있으면
 * worktree의 상태(in_progress)는 PR head(completed)와 다르다
 */
export function stepCompletedAt(cwd: string, rev: string, branch: string): boolean | null {
  try {
    const b = parseBranch(branch);
    if (!b || !/^[0-9a-f]{40}$/.test(rev)) return null;
    const read = (f: string) => showFile(cwd, rev, f);
    const ref = findPlanAt(read, b.id);
    if (!ref) return null;
    if (ref.kind === 'multi') {
      const text = read(`${ref.dir}/index.json`);
      if (text === null) return null;
      return parseIndex(text).steps[b.step ?? 0]?.status === 'completed';
    }
    const text = read(ref.file);
    return text === null ? null : parseDoc(text).frontmatter?.status === 'completed';
  } catch {
    return null;
  }
}

/**
 * PR이 맡은 step이 completed인가. PR head(`headSha`)의 계획을 먼저 보고, 읽지 못하면 그 브랜치의 worktree에서 읽는다.
 * 둘 다 못 읽으면 true로 본다(완료된 step의 PR로 다룬다: 실패한 게이트를 숨기지 않는다)
 */
export function stepCompletedOf(cwd: string, branch: string, headSha = ''): boolean {
  const atHead = headSha ? stepCompletedAt(cwd, headSha, branch) : null;
  if (atHead !== null) return atHead;
  try {
    const wt = worktreeOfBranch(cwd, branch);
    const b = parseBranch(branch);
    const ref = wt && b ? findPlan(wt.root, b.id) : null;
    if (!wt || !b || !ref) return true;
    if (ref.kind === 'multi') {
      return readIndex(wt.root, ref).steps[b.step ?? 0]?.status === 'completed';
    }
    const fm = parseDoc(readFileSync(path.join(wt.root, ref.file), 'utf8')).frontmatter;
    return fm?.status === 'completed';
  } catch {
    return true;
  }
}

/** PR head가 기준 브랜치에 뒤처졌는가. head 커밋이 로컬에 없으면 null(알 수 없음) */
export function behindOf(
  cwd: string,
  remote: string,
  branch: string,
  headSha: string,
): boolean | null {
  if (!/^[0-9a-f]{40}$/.test(headSha)) return null;
  if (!gitTry(['cat-file', '-e', `${headSha}^{commit}`], cwd).ok) return null;
  return isBehind(cwd, remote, branch, headSha);
}

/**
 * 오래 열린 지적(9.1절)을 한 줄씩 낸다. 대화 세션이 제작자에게 물을 신호다. 읽기만 한다.
 * 지적의 제목·위치(검증자 출력)는 내지 않는다. 원장을 가릴 수 없으면(ci.recorderBot 없음) 아무것도 내지 않는다
 */
function logLongOpen(gh: GitHubPort, cfg: HarnessConfig, pr: number): void {
  if (!cfg.ci.recorderBot) return;
  try {
    const ledger = readPrLedger(gh, cfg, pr);
    for (const x of ledger ? longOpen(ledger) : [])
      log(
        `- 오래 열린 지적: ${x.entry.id} [${x.entry.severity}, ${x.entry.reviewer}] 재판정 ${x.rejudged}회 뒤에도 열려 있다 — 대화 세션은 더 고쳐 올리기 전에 제작자에게 묻는다(절차서 8절)`,
      );
  } catch (e) {
    log(`- 오래 열린 지적 확인: 원장을 읽지 못했다(${(e as Error).message.split('\n')[0]})`);
  }
}

export function prState(cwd: string, prNumber: number | null): number {
  const info = repoInfo(cwd);
  const cfg = loadConfig(info.root);
  const gh = getGitHub(info.root);
  let pr: PullRequest | null;
  if (prNumber === null) pr = info.branch ? gh.findPRByBranch(info.branch) : null;
  else pr = gh.getPR(prNumber);
  if (!pr) {
    process.stderr.write(
      prNumber === null
        ? `브랜치 ${info.branch || '(없음)'}의 PR이 없다\n고치는 법: PR이 있는 worktree에서 실행하거나 --pr <번호>를 준다\n`
        : `PR #${prNumber}이 없다\n`,
    );
    return 1;
  }
  log(
    `PR #${pr.number} (${pr.head}) head ${pr.headSha.slice(0, 12) || '?'} · ${pr.state}${pr.isDraft ? ' · 초안' : ''} · mergeStateStatus=${pr.mergeState || '?'} · 자동 병합 ${pr.autoMerge ? '켜짐' : '꺼짐'}`,
  );
  if (cfg.ci.requiredChecks.length === 0) {
    log(
      `ci.requiredChecks가 비어 있어 출처별 판정을 하지 않는다. 체크 요약: ${pr.checks}${pr.failingChecks.length ? ` (실패: ${pr.failingChecks.join(', ')})` : ''}`,
    );
    logLongOpen(gh, cfg, pr.number);
    return 0;
  }
  const required = requiredStates(pr.headSha ? gh.commitChecks(pr.headSha) : [], cfg.ci);
  for (const r of required) {
    log(`- ${r.context} [${r.source}]: ${r.state}${r.description ? ` — ${r.description}` : ''}`);
  }
  logLongOpen(gh, cfg, pr.number);
  const { remote, defaultBranch } = cfg.github;
  const behind = behindOf(info.root, remote, defaultBranch, pr.headSha);
  const stepCompleted = stepCompletedOf(info.root, pr.head, pr.headSha);
  const verdict = classifyPr({ pr, required, behind: behind === true, stepCompleted });
  log(
    `분류: ${describeVerdict(verdict)} · 뒤처짐: ${behind === null ? '알 수 없음' : behind ? '예' : '아니오'} · step 완료: ${stepCompleted ? '예' : '아니오'}`,
  );
  return 0;
}
