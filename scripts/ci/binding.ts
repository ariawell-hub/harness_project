// 승인 결속(10.3절). 코드 검증(review/*)의 승인은 merge-base 대비 diff의 `git patch-id --stable`에 묶는다.
// main 병합으로 갱신한 뒤 patch-id가 같고, 위험도가 낮음·보통이고, 그사이 main에서 바뀐 파일이 PR이 바꾼 파일과
// 겹치지 않으면 LLM 없이 새 head로 승인을 옮긴다. patch-id는 승인 상태의 description 끝에 적어 두고,
// 이어받을 때는 그 상태를 검증 App 봇이 썼는지 확인한다(봇 PAT도 같은 이름의 상태를 쓸 수 있다, ADR-0003).
// patch-id는 PR ref가 아니라 체크아웃한 이벤트 head에서 잰다(push 직후 PR ref는 옛 head일 수 있다, Q20).
import { changedFiles, type Risk } from '../gates/risk-gate.ts';
import { spawnSync } from 'node:child_process';
import { gitTry } from '../lib/git.ts';
import { DESCRIPTION_MAX, SHA_RE } from './results.ts';

/** merge-base 대비 diff의 patch-id. 변경이 없으면 '' */
export function patchId(root: string, base: string): string {
  // 문자열로 바꾸지 않고 바이트 그대로 넘긴다(UTF-8이 아닌 텍스트의 차이가 사라지지 않게).
  // --binary --full-index: 바이너리 파일의 내용과 전체 blob id가 patch에 들어가게 한다
  const opts = { cwd: root, maxBuffer: 256 * 1024 * 1024, windowsHide: true } as const;
  const diff = spawnSync(
    'git',
    [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '--binary',
      '--full-index',
      `${base}...HEAD`,
    ],
    opts,
  );
  if (diff.status !== 0)
    throw new Error(
      `git diff 실패: ${String(diff.stderr ?? diff.error?.message ?? '').slice(0, 200)}`,
    );
  if (!diff.stdout.length) return '';
  const r = spawnSync('git', ['patch-id', '--stable'], { ...opts, input: diff.stdout });
  if (r.status !== 0)
    throw new Error(
      `git patch-id 실패: ${String(r.stderr ?? r.error?.message ?? '').slice(0, 200)}`,
    );
  const id = r.stdout.toString('utf8').trim().split(/\s+/)[0] ?? '';
  return /^[0-9a-f]{40}$/.test(id) ? id : '';
}

const validPatch = (patch: string) => /^[0-9a-f]{40}$/.test(patch);

/**
 * description 끝에 ` patch:<id 전체>`를 붙인다. 상태 description 상한(140자) 안에 들도록 앞을 줄인다.
 * id를 줄여 적지 않는다. PR 작성자는 두 diff를 모두 정할 수 있어, 앞부분만 같은 쌍을 만들 수 있다
 */
export function withPatch(description: string, patch: string): string {
  if (!validPatch(patch)) return description;
  const tag = ` patch:${patch}`;
  return description.slice(0, DESCRIPTION_MAX - tag.length) + tag;
}

export function patchOf(description: string): string | null {
  return /(?:^| )patch:([0-9a-f]{40})$/.exec(description)?.[1] ?? null;
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

/**
 * PR이 바꾼 파일이 옛 head와 지금 head에서 바이트 단위로 같은가.
 * `git patch-id`는 공백을 무시하므로, 승인 뒤 공백만 바꾼 커밋(들여쓰기, 따옴표 안의 공백)을 patch-id로는 걸러 내지 못한다.
 * main 병합 갱신은 PR 파일을 건드리지 않으므로(겹침은 따로 본다) 항상 같다.
 */
export function samePrContent(root: string, oldHead: string, prFiles: string[]): boolean {
  if (!SHA_RE.test(oldHead) || !prFiles.length) return false;
  // PR 파일 이름을 git 인자로 넘기지 않는다. `--` 뒤 인자는 pathspec이라 `:!a.txt` 같은 이름이 비교 대상을 비울 수 있다
  const d = gitTry(['diff', '--name-only', '-z', '--no-renames', oldHead, 'HEAD'], root);
  if (!d.ok) return false;
  const mine = new Set(prFiles);
  return !d.stdout.split('\0').some((f) => f && mine.has(f));
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
  /** PR 파일이 옛 head와 지금 head에서 바이트 단위로 같은가 */
  samePrContent: (oldHead: string) => boolean;
  /** 검증 App 봇의 login(`ci.recorderBot`) */
  recorderBot: string;
  context: string;
}

export function carryOver(o: CarryOptions): { from: string } | { no: string } {
  if (!o.recorderBot) return { no: 'ci.recorderBot 설정이 없어 상태의 작성자를 확인할 수 없다' };
  if (o.risk === 'high') return { no: '위험도 높음은 patch가 같아도 다시 검증한다' };
  if (!validPatch(o.patch)) return { no: '지금 head의 patch가 없다' };
  for (const c of o.candidates) {
    // 작성자를 확인한 상태만 본다. 그 head에 판정 기록이 없으면 더 앞의 head를 본다.
    // 중간 커밋일 수도, 판정이 아직 줄 서 있는 head일 수도 있다. 어느 쪽이든 아래 조건(patch 같음,
    // PR 파일이 그 head와 바이트 단위로 같음)을 만족해야 하므로 검증된 내용만 이어받는다
    const mine = c.statuses.filter((s) => s.creator === o.recorderBot && s.context === o.context);
    if (!mine.length) continue;
    // 가장 최근에 판정된 head의 마지막 상태만 근거로 쓴다
    const last = mine[0];
    if (last.state !== 'success') return { no: `앞선 head의 마지막 판정이 success가 아니다` };
    if (patchOf(last.description) !== o.patch)
      return { no: '앞선 승인의 patch가 다르다(또는 적혀 있지 않다)' };
    const changed = o.changedOnBaseSince(c.sha);
    if (changed === null)
      return { no: '그사이 main 변경을 조회하지 못했다(앞선 head가 조상이 아닐 수 있다)' };
    const mineFiles = new Set(o.prFiles);
    const overlap = changed.filter((f) => mineFiles.has(f));
    if (overlap.length)
      return { no: `그사이 main에서 바뀐 파일이 PR 파일과 겹친다: ${overlap[0]}` };
    if (!o.samePrContent(c.sha))
      return { no: 'PR 파일의 내용이 다르다(patch-id는 공백 차이를 보지 않는다)' };
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
 * 이 PR의 head 후보(지금 head 포함)와 그 커밋 상태(읽기 전용 조회). 최신이 먼저다.
 * 지금 head도 넣는다. 같은 head를 다시 돌릴 때 그 head의 실패 판정을 건너뛰고 옛 승인을 되살리지 않기 위해서다.
 * 지금 head의 마지막 판정이 승인이면 그 승인을 그대로 잇는다(다시 판정하지 않는다).
 * 검증 App이 쓴 `contexts` 상태가 모두 있는 head를 찾으면 멈춘다(그 앞은 쓰지 않는다).
 */
export async function fetchCandidates(o: {
  api: (path: string) => Promise<unknown>;
  repo: string;
  number: number;
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

export interface CarryPlan {
  /** 지금 head의 patch-id. 재지 못했으면 '' */
  patch: string;
  /** 이어받을 원래 head SHA. 이어받지 않으면 '' */
  claude: string;
  codex: string;
  /** 로그에 낼 판정 이유 */
  notes: string[];
}

/**
 * 판정 워크플로의 plan job이 쓰는 이어받기 판정(review-plan). 판정하지 못하면 이어받지 않는다(다시 검증).
 * 위험도 높음이거나 봇 설정이 없으면 조회하지 않는다.
 */
export async function planCarry(o: {
  /** PR head 체크아웃 */
  root: string;
  /** merge-base */
  base: string;
  /** PR의 base 브랜치 끝(SHA 또는 ref) */
  baseSha: string;
  number: number;
  /** owner/name */
  repo: string;
  risk: Risk;
  /** 이 PR에 필요한 검증자 */
  need: { claude: boolean; codex: boolean };
  recorderBot: string;
  api: (path: string) => Promise<unknown>;
}): Promise<CarryPlan> {
  const out: CarryPlan = { patch: '', claude: '', codex: '', notes: [] };
  const keys = (['claude', 'codex'] as const).filter((k) => o.need[k]);
  try {
    out.patch = patchId(o.root, o.base);
    const lookup = Boolean(o.recorderBot) && out.patch !== '' && o.risk !== 'high' && keys.length;
    const candidates = lookup
      ? await fetchCandidates({
          api: o.api,
          repo: o.repo,
          number: o.number,
          recorderBot: o.recorderBot,
          contexts: keys.map((k) => `review/${k}`),
        })
      : [];
    // rename의 원본 경로도 PR 파일이다(겹침 검사와 같은 기준: --no-renames)
    const prFiles = changedFiles(o.root, o.base).map((f) => f.path);
    for (const k of keys) {
      const c = carryOver({
        patch: out.patch,
        risk: o.risk,
        prFiles,
        candidates,
        changedOnBaseSince: (old) => changedOnBaseSince(o.root, o.baseSha, old),
        samePrContent: (old) => samePrContent(o.root, old, prFiles),
        recorderBot: o.recorderBot,
        context: `review/${k}`,
      });
      if ('from' in c) out[k] = c.from;
      out.notes.push(
        `review/${k} ${'from' in c ? `이어받음 ← ${c.from.slice(0, 12)}` : `다시 검증 — ${c.no}`}`,
      );
    }
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).split('\n')[0].slice(0, 200);
    out.claude = '';
    out.codex = '';
    out.notes.push(`이어받기를 판정하지 못했다(다시 검증) — ${msg}`);
  }
  return out;
}
