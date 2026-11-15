// 승인 결속(10.3절). 코드 검증(review/*)의 승인은 merge-base 대비 diff의 `git patch-id --stable`에 묶는다.
// main 병합으로 갱신한 뒤 patch-id가 같고, 위험도가 낮음·보통이고, 그사이 main에서 바뀐 파일이 PR이 바꾼 파일과
// 겹치지 않으면 LLM 없이 새 head로 승인을 옮긴다. patch-id는 승인 상태의 description 끝에 적어 두고,
// 이어받을 때는 그 상태를 검증 App 봇이 썼는지 확인한다(봇 PAT도 같은 이름의 상태를 쓸 수 있다, ADR-0003).
// patch-id는 PR ref가 아니라 체크아웃한 이벤트 head에서 잰다(push 직후 PR ref는 옛 head일 수 있다, Q20).
import type { Risk } from '../gates/risk-gate.ts';
import { runSync } from '../lib/exec.ts';
import { git, gitTry } from '../lib/git.ts';
import { SHA_RE } from './results.ts';

const TAG_LEN = 16;
const MAX_DESCRIPTION = 140;

/** merge-base 대비 diff의 patch-id. 변경이 없으면 '' */
export function patchId(root: string, base: string): string {
  const diff = git(
    ['diff', '--no-ext-diff', '--no-textconv', '--no-color', `${base}...HEAD`],
    root,
  );
  if (!diff.trim()) return '';
  const r = runSync('git', ['patch-id', '--stable'], { cwd: root, input: diff + '\n' });
  if (r.code !== 0) throw new Error(`git patch-id 실패: ${r.stderr.trim().slice(0, 200)}`);
  const id = r.stdout.trim().split(/\s+/)[0] ?? '';
  return /^[0-9a-f]{40}$/.test(id) ? id : '';
}

const validPatch = (patch: string) => /^[0-9a-f]{16,40}$/.test(patch);

/** description 끝에 ` patch:<앞 16자>`를 붙인다. 상태 description 상한(140자) 안에 들도록 앞을 줄인다 */
export function withPatch(description: string, patch: string): string {
  if (!validPatch(patch)) return description;
  const tag = ` patch:${patch.slice(0, TAG_LEN)}`;
  return description.slice(0, MAX_DESCRIPTION - tag.length) + tag;
}

export function patchOf(description: string): string | null {
  return /(?:^| )patch:([0-9a-f]{16})$/.exec(description)?.[1] ?? null;
}

/**
 * 옛 head 때의 base 이후 base 브랜치에서 바뀐 파일. 옛 head가 지금 head의 조상이 아니면(강제 push 등) null
 */
export function changedOnBaseSince(
  root: string,
  baseRef: string,
  oldHead: string,
): string[] | null {
  if (!SHA_RE.test(oldHead)) return null;
  if (!gitTry(['merge-base', '--is-ancestor', oldHead, 'HEAD'], root).ok) return null;
  const oldBase = gitTry(['merge-base', oldHead, baseRef], root);
  const newBase = gitTry(['merge-base', 'HEAD', baseRef], root);
  if (!oldBase.ok || !newBase.ok) return null;
  const d = gitTry(
    ['diff', '--name-only', '-z', '--no-renames', oldBase.stdout.trim(), newBase.stdout.trim()],
    root,
  );
  return d.ok ? d.stdout.split('\0').filter(Boolean) : null;
}

export interface CommitStatus {
  context: string;
  state: string;
  description: string;
  /** 상태를 쓴 계정의 login */
  creator: string;
}

export interface Candidate {
  sha: string;
  /** 최신이 먼저 */
  statuses: CommitStatus[];
}

export interface CarryOptions {
  /** 지금 head의 patch-id */
  patch: string;
  risk: Risk;
  /** PR이 바꾼 파일 */
  prFiles: string[];
  /** 이 PR의 앞선 head들. 최신이 먼저 */
  candidates: Candidate[];
  changedOnBaseSince: (oldHead: string) => string[] | null;
  /** 검증 App 봇의 login(`ci.recorderBot`) */
  recorderBot: string;
  context: string;
}

export function carryOver(o: CarryOptions): { from: string } | { no: string } {
  if (!o.recorderBot) return { no: 'ci.recorderBot 설정이 없어 상태의 작성자를 확인할 수 없다' };
  if (o.risk === 'high') return { no: '위험도 높음은 patch가 같아도 다시 검증한다' };
  if (!validPatch(o.patch)) return { no: '지금 head의 patch가 없다' };
  for (const c of o.candidates) {
    // 작성자를 확인한 상태만 본다. 그 head에 판정 기록이 없으면(중간 커밋) 더 앞의 head를 본다
    const mine = c.statuses.filter((s) => s.creator === o.recorderBot && s.context === o.context);
    if (!mine.length) continue;
    // 가장 최근에 판정된 head의 마지막 상태만 근거로 쓴다
    const last = mine[0];
    if (last.state !== 'success') return { no: `앞선 head의 마지막 판정이 success가 아니다` };
    if (patchOf(last.description) !== o.patch.slice(0, TAG_LEN))
      return { no: '앞선 승인의 patch가 다르다(또는 적혀 있지 않다)' };
    const changed = o.changedOnBaseSince(c.sha);
    if (changed === null)
      return { no: '그사이 main 변경을 조회하지 못했다(앞선 head가 조상이 아닐 수 있다)' };
    const mineFiles = new Set(o.prFiles);
    const overlap = changed.filter((f) => mineFiles.has(f));
    if (overlap.length)
      return { no: `그사이 main에서 바뀐 파일이 PR 파일과 겹친다: ${overlap[0]}` };
    return { from: c.sha };
  }
  return { no: '앞선 head에 검증 App의 판정이 없다' };
}

interface RawCommit {
  sha?: unknown;
}
interface RawStatus {
  context?: unknown;
  state?: unknown;
  description?: unknown;
  creator?: { login?: unknown } | null;
}

/**
 * 이 PR의 앞선 head 후보와 그 커밋 상태(읽기 전용 조회). 최신이 먼저다.
 * 검증 App이 쓴 `contexts` 상태가 모두 있는 head를 찾으면 멈춘다(그 앞은 쓰지 않는다).
 */
export async function fetchCandidates(o: {
  api: (path: string) => Promise<unknown>;
  repo: string;
  number: number;
  headSha: string;
  recorderBot: string;
  contexts: readonly string[];
  limit?: number;
}): Promise<Candidate[]> {
  const shas: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const list = await o.api(`repos/${o.repo}/pulls/${o.number}/commits?per_page=100&page=${page}`);
    if (!Array.isArray(list)) throw new Error('PR 커밋 목록 응답이 배열이 아니다');
    for (const c of list as RawCommit[])
      if (typeof c?.sha === 'string' && SHA_RE.test(c.sha)) shas.push(c.sha);
    if (list.length < 100) break;
  }
  const out: Candidate[] = [];
  for (const sha of shas.reverse()) {
    if (sha === o.headSha) continue;
    if (out.length >= (o.limit ?? 20)) break;
    const list = await o.api(`repos/${o.repo}/commits/${sha}/statuses?per_page=100`);
    if (!Array.isArray(list)) throw new Error('커밋 상태 응답이 배열이 아니다');
    const statuses = (list as RawStatus[]).map((s) => ({
      context: String(s?.context ?? ''),
      state: String(s?.state ?? ''),
      description: typeof s?.description === 'string' ? s.description : '',
      creator: typeof s?.creator?.login === 'string' ? s.creator.login : '',
    }));
    out.push({ sha, statuses });
    const judged = (ctx: string) =>
      statuses.some((s) => s.creator === o.recorderBot && s.context === ctx);
    if (o.contexts.every(judged)) break;
  }
  return out;
}
