// GitHub 연동 포트. 실제 구현은 gh CLI(봇 계정 GH_TOKEN, E1)를 쓰고,
// 테스트·스모크 테스트에서는 HARNESS_FAKE_GH=<상태 파일>로 가짜 구현을 쓴다(github-fake.ts).
import { runSync } from './exec.ts';
import { FakeGitHub } from './github-fake.ts';

/** 내용(Issue 제목·본문, 댓글 본문)을 만들거나 바꾼 한 번. `by`는 계정 login(알 수 없으면 ''), `at`은 ISO 시각 */
export interface Change {
  by: string;
  at: string;
}

/**
 * 만든 것부터의 변경 이력(9.1절·14.6절 신뢰 판정, TD-19·TD-26). `changes`의 첫 항목은 만든 계정이다.
 * `complete`가 false면 이력을 다 읽지 못했다. 판정은 이를 불신으로 다룬다(fail-closed)
 */
export interface ContentHistory {
  changes: Change[];
  complete: boolean;
}

export interface Comment {
  author: string;
  body: string;
  createdAt: string;
  /** 본문 변경 이력. 확인하지 못했으면 null */
  history: ContentHistory | null;
}

/** Issue 본문 편집과 제목 변경을 합친 이력과, 같은 조회에서 읽은 제목·본문 */
export interface IssueHistory extends ContentHistory {
  title: string;
  body: string;
}

/** GraphQL `userContentEdits` 원시 형태(최신순, 처음 작성분 포함) */
export interface RawEdits {
  totalCount: number;
  nodes: ({ editedAt?: string | null; editor?: { login?: string | null } | null } | null)[];
}

/** GraphQL `timelineItems(itemTypes: [RENAMED_TITLE_EVENT])` 원시 형태 */
export interface RawRenames {
  totalCount: number;
  nodes: ({ createdAt?: string | null; actor?: { login?: string | null } | null } | null)[];
}

/** 이력 변환에 쓰는 GraphQL 댓글·Issue 필드 */
export interface RawContent {
  author?: { login?: string | null } | null;
  createdAt: string;
  lastEditedAt?: string | null;
  /** 마지막으로 고친 계정 */
  editor?: { login?: string | null } | null;
  userContentEdits?: RawEdits | null;
}

/**
 * GraphQL 원시 응답을 변경 이력으로 바꾼다. 만든 계정·시각을 첫 변경으로 넣고, 마지막 편집(`editor`·
 * `lastEditedAt`. 편집 기록의 개별 항목이 지워져도 남는다), 편집 기록, 제목 변경을 더한다.
 * 기록이 `totalCount`보다 적거나, 편집 기록 필드가 없거나, 고친 시각(`lastEditedAt`)이 있는데 기록이 없으면
 * `complete: false`다. 삭제된 계정은 빈 login이다
 */
export function toContentHistory(raw: RawContent, renames?: RawRenames | null): ContentHistory {
  const changes: Change[] = [{ by: raw.author?.login ?? '', at: raw.createdAt }];
  if (raw.lastEditedAt) changes.push({ by: raw.editor?.login ?? '', at: raw.lastEditedAt });
  const edits = raw.userContentEdits;
  let complete = !!edits && edits.nodes.length >= edits.totalCount;
  if (raw.lastEditedAt && (!edits || edits.totalCount === 0)) complete = false;
  for (const e of edits?.nodes ?? [])
    changes.push({ by: e?.editor?.login ?? '', at: e?.editedAt ?? '' });
  if (renames) {
    if (renames.nodes.length < renames.totalCount) complete = false;
    for (const r of renames.nodes)
      changes.push({ by: r?.actor?.login ?? '', at: r?.createdAt ?? '' });
  }
  return { changes: dedupe(changes), complete };
}

/** 같은 계정·시각의 변경(처음 작성분과 편집 기록의 첫 항목)은 하나로 둔다 */
function dedupe(changes: Change[]): Change[] {
  const seen = new Set<string>();
  return changes.filter((c) => {
    const k = `${c.by}\n${c.at}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface Issue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'open' | 'closed';
  createdAt: string;
  /** 작성자 login. 알 수 없으면(삭제된 계정 등) '' */
  author: string;
}

export type ChecksState = 'none' | 'pending' | 'success' | 'failure';

export interface PullRequest {
  number: number;
  title: string;
  body: string;
  head: string;
  /** PR head 커밋 SHA. 알 수 없으면 '' */
  headSha: string;
  state: 'open' | 'merged' | 'closed';
  isDraft: boolean;
  /** 자동 병합이 켜져 있는가 */
  autoMerge: boolean;
  labels: string[];
  url: string;
  /** BEHIND면 main에 뒤처짐 */
  mergeState: string;
  /** 체크 요약(출처를 보지 않는다, 10.3절). 필수 체크 판정은 commitChecks와 runner/pr-state.ts를 쓴다 */
  checks: ChecksState;
  failingChecks: string[];
}

/**
 * 커밋에 달린 커밋 상태 하나 또는 check run 하나. 출처(creator·appId)를 함께 담는다.
 * 같은 이름의 결과를 다른 계정·App도 쓸 수 있으므로(ADR-0003, Q20) 판정은 출처로 거른 뒤에 한다
 */
export interface CommitCheck {
  /** 커밋 상태의 context 또는 check run 이름 */
  context: string;
  kind: 'status' | 'check-run';
  state: 'success' | 'failure' | 'error' | 'pending';
  description: string;
  /** 커밋 상태를 쓴 계정 login. check run은 '' */
  creator: string;
  /** check run을 만든 App id. 커밋 상태는 null */
  appId: number | null;
  targetUrl: string;
  /** 기록 시각(ISO) */
  at: string;
}

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const STATUS_STATES: readonly string[] = ['success', 'failure', 'error', 'pending'];

/** `GET commits/{sha}/statuses` 항목에서 뽑은 값: [context, state, description, creator, target_url, created_at] */
export type RawStatusRow = [string, string, string | null, string | null, string | null, string];

export function statusToCheck(r: RawStatusRow): CommitCheck {
  return {
    context: r[0],
    kind: 'status',
    // 모르는 값은 통과로 보지 않는다
    state: STATUS_STATES.includes(r[1]) ? (r[1] as CommitCheck['state']) : 'error',
    description: r[2] ?? '',
    creator: r[3] ?? '',
    appId: null,
    targetUrl: r[4] ?? '',
    at: r[5],
  };
}

/** `GET commits/{sha}/check-runs` 항목에서 뽑은 값: [name, status, conclusion, app id, url, 끝난·시작 시각, 제목] */
export type RawCheckRunRow = [
  string,
  string,
  string | null,
  number | null,
  string | null,
  string | null,
  string | null,
];

/** 끝나지 않았으면 pending. success·neutral·skipped만 통과이고(GitHub 필수 체크 기준) 나머지 결론은 failure다 */
export function checkRunToCheck(r: RawCheckRunRow): CommitCheck {
  const done = r[1] === 'completed';
  const passed = r[2] === 'success' || r[2] === 'neutral' || r[2] === 'skipped';
  return {
    context: r[0],
    kind: 'check-run',
    state: !done ? 'pending' : passed ? 'success' : 'failure',
    description: r[6] ?? '',
    creator: '',
    appId: typeof r[3] === 'number' ? r[3] : null,
    targetUrl: r[4] ?? '',
    at: r[5] ?? '',
  };
}

/** 최신순. 시각이 같으면 받은 순서를 지킨다 */
export function newestFirst(list: CommitCheck[]): CommitCheck[] {
  return list
    .map((c, i) => ({ c, i }))
    .sort((a, b) => (a.c.at < b.c.at ? 1 : a.c.at > b.c.at ? -1 : a.i - b.i))
    .map((x) => x.c);
}

export interface GitHubPort {
  readonly kind: 'gh' | 'fake';
  me(): string;
  listOpenIssues(): Issue[];
  getIssue(n: number): Issue;
  /** Issue 제목·본문과 그 변경 이력(본문 편집 + 제목 변경) */
  issueHistory(n: number): IssueHistory;
  /** 최근 댓글(오래된 것부터, 최대 100개)과 각 댓글의 편집 이력 */
  comments(n: number): Comment[];
  comment(n: number, body: string): void;
  /**
   * PR(또는 Issue)의 댓글 전체를 시간순으로. 지적 원장(10.2절 (4))을 읽는 데 쓴다.
   * 끝까지 읽지 못하면 예외다(일부만 읽고 "원장이 없다"고 판단하지 않는다)
   */
  prComments(n: number): { id: number; author: string; body: string }[];
  addLabel(n: number, label: string): void;
  removeLabel(n: number, label: string): void;
  reopenIssue(n: number): void;
  listMyOpenPRs(): PullRequest[];
  findPRByBranch(branch: string): PullRequest | null;
  /** 번호로 PR을 찾는다. 없으면 null */
  getPR(n: number): PullRequest | null;
  /**
   * 그 커밋의 커밋 상태 전체 기록(같은 context의 옛 기록 포함)과 check run 전체, 최신순.
   * context별 최신 하나만 주는 API(체크 요약, combined status)로 만들지 않는다: 출처가 다른 같은 이름의 결과가
   * 뒤에 쓰이면 앞선 결과가 가려진다(10.3절)
   */
  commitChecks(sha: string): CommitCheck[];
  createPR(p: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): PullRequest;
  enableAutoMerge(n: number): void;
  /** PR을 초안으로 바꾸거나(draft=true) 초안을 해제한다. 승인·병합과는 무관하다 */
  setDraft(n: number, draft: boolean): void;
  /** `GET repos/{repo}/branches/{branch}` 원본(필수 체크 등록 확인용, 봇 토큰으로 읽을 수 있다) */
  branchInfo(branch: string): unknown;
  /** 이 저장소의 이름(`owner/name`) */
  repoSlug(): string;
  /**
   * Actions 실행의 로그 전문(줄마다 job·step·시각이 앞에 붙는다). 지적의 근거·제안을 읽는 데 쓴다(10.1절).
   * URL이 이 리포의 실행 URL 형식이 아니거나 읽지 못하면 null이다(예외를 던지지 않는다)
   */
  runLog(runUrl: string): string | null;
}

/**
 * 이 리포의 Actions 실행 URL(`https://github.com/<owner>/<name>/actions/runs/<번호>`, 뒤에 `/job/…`·`/attempts/…`가
 * 붙어도 된다)에서 실행 번호를 얻는다. 형식이 다르면 null. 커밋 상태의 링크는 기록 job이 쓰지만,
 * 다른 리포나 다른 주소의 값을 `gh` 인자로 넘기지 않게 여기서 거른다
 */
export function runIdOf(runUrl: string, repo: string): string | null {
  const prefix = `https://github.com/${repo}/actions/runs/`;
  if (!repo || !runUrl.startsWith(prefix)) return null;
  const m = /^(\d{1,20})(?:\/(?:job|attempts)\/\d{1,20})?\/?$/.exec(runUrl.slice(prefix.length));
  return m ? m[1] : null;
}

export class GitHubError extends Error {}

function gh(args: string[], cwd: string, input?: string): string {
  const r = runSync('gh', args, { cwd, input, timeoutMs: 120_000 });
  if (r.code !== 0)
    throw new GitHubError(`gh ${args.slice(0, 3).join(' ')} 실패: ${r.stderr.trim()}`);
  return r.stdout;
}

interface RawCheck {
  conclusion?: string | null;
  status?: string | null;
  state?: string | null;
  name?: string;
  context?: string;
}

export function summarizeChecks(rollup: RawCheck[] | null | undefined): {
  checks: ChecksState;
  failing: string[];
} {
  if (!rollup || rollup.length === 0) return { checks: 'none', failing: [] };
  const failing: string[] = [];
  let pending = false;
  for (const c of rollup) {
    const result = (c.conclusion ?? c.state ?? '').toUpperCase();
    const status = (c.status ?? '').toUpperCase();
    if (['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(result)) {
      failing.push(c.name ?? c.context ?? '?');
    } else if (result === 'PENDING' || (status && status !== 'COMPLETED') || result === '') {
      pending = true;
    }
  }
  if (failing.length) return { checks: 'failure', failing };
  return { checks: pending ? 'pending' : 'success', failing };
}

const PR_FIELDS =
  'number,title,body,headRefName,headRefOid,state,isDraft,autoMergeRequest,labels,url,mergeStateStatus,statusCheckRollup';

interface RawPR {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  headRefOid?: string | null;
  state: string;
  isDraft: boolean;
  autoMergeRequest?: unknown;
  labels: { name: string }[];
  url: string;
  mergeStateStatus: string;
  statusCheckRollup: RawCheck[];
}

function toPR(r: RawPR): PullRequest {
  const s = summarizeChecks(r.statusCheckRollup);
  return {
    number: r.number,
    title: r.title,
    body: r.body ?? '',
    head: r.headRefName,
    headSha: r.headRefOid ?? '',
    state: r.state === 'MERGED' ? 'merged' : r.state === 'CLOSED' ? 'closed' : 'open',
    isDraft: r.isDraft,
    autoMerge: !!r.autoMergeRequest,
    labels: (r.labels ?? []).map((l) => l.name),
    url: r.url,
    mergeState: r.mergeStateStatus ?? '',
    checks: s.checks,
    failingChecks: s.failing,
  };
}

const ISSUE_FIELDS = 'number,title,body,labels,state,createdAt,author';

/**
 * `gh api --paginate … --jq '.[] | [.id, .user.login, .body] | @json'`의 출력(한 줄에 댓글 하나)을 읽는다.
 * 페이지가 여럿이어도 줄이 이어질 뿐이다. 형식이 다른 줄이 하나라도 있으면 예외다(일부만 읽고 넘어가지 않는다)
 */
export function parseCommentRows(stdout: string): { id: number; author: string; body: string }[] {
  return stdout
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => {
      const row: unknown = JSON.parse(l);
      if (!Array.isArray(row) || row.length !== 3 || typeof row[0] !== 'number')
        throw new GitHubError('댓글 목록 형식 오류');
      const [id, author, body] = row as [number, unknown, unknown];
      return {
        id,
        author: typeof author === 'string' ? author : '',
        body: typeof body === 'string' ? body : '',
      };
    });
}

// 편집 이력 조회(TD-19·TD-26). 편집 기록·제목 변경이 이보다 많으면 불완전으로 보고 신뢰하지 않는다
const EDITS = 'userContentEdits(first: 100) { totalCount nodes { editedAt editor { login } } }';
const ISSUE_HISTORY_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issue(number: $n) {
      title body createdAt lastEditedAt author { login } editor { login }
      ${EDITS}
      timelineItems(itemTypes: [RENAMED_TITLE_EVENT], first: 100) {
        totalCount nodes { ... on RenamedTitleEvent { createdAt actor { login } } }
      }
    }
  }
}`;
// 최근 100개(오래된 것부터). 댓글마다 편집 기록은 20개까지 읽는다
const COMMENT_FIELDS = `nodes { body createdAt lastEditedAt author { login } editor { login } ${EDITS.replace('100', '20')} }`;
const COMMENTS_QUERY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    issueOrPullRequest(number: $n) {
      ... on Issue { comments(last: 100) { ${COMMENT_FIELDS} } }
      ... on PullRequest { comments(last: 100) { ${COMMENT_FIELDS} } }
    }
  }
}`;

/** `gh issue list|view --json ISSUE_FIELDS`의 원시 형태 */
export interface RawIssue {
  number: number;
  title: string;
  body?: string | null;
  labels?: { name: string }[] | null;
  state: string;
  createdAt: string;
  /** 삭제된 계정이면 null */
  author?: { login?: string | null } | null;
}

export function toIssue(raw: RawIssue): Issue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? '',
    labels: (raw.labels ?? []).map((l) => l.name),
    state: raw.state === 'OPEN' ? 'open' : 'closed',
    createdAt: raw.createdAt,
    author: raw.author?.login ?? '',
  };
}

export class GhCli implements GitHubPort {
  readonly kind = 'gh' as const;
  private cwd: string;
  private login: string | null = null;
  private slug: string | null = null;
  constructor(cwd: string) {
    this.cwd = cwd;
  }
  repoSlug(): string {
    this.slug ??= gh(
      ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
      this.cwd,
    ).trim();
    return this.slug;
  }
  runLog(runUrl: string): string | null {
    try {
      const id = runIdOf(runUrl, this.repoSlug());
      if (!id) return null;
      const r = runSync('gh', ['run', 'view', id, '--log'], { cwd: this.cwd, timeoutMs: 120_000 });
      return r.code === 0 && r.stdout.trim() !== '' ? r.stdout : null;
    } catch {
      return null;
    }
  }
  branchInfo(branch: string): unknown {
    return JSON.parse(
      gh(['api', `repos/{owner}/{repo}/branches/${encodeURIComponent(branch)}`], this.cwd),
    );
  }
  me(): string {
    this.login ??= gh(['api', 'user', '--jq', '.login'], this.cwd).trim();
    return this.login;
  }
  listOpenIssues(): Issue[] {
    const raw = JSON.parse(
      gh(['issue', 'list', '--state', 'open', '--limit', '200', '--json', ISSUE_FIELDS], this.cwd),
    ) as RawIssue[];
    return raw.map(toIssue);
  }
  getIssue(n: number): Issue {
    const raw = JSON.parse(
      gh(['issue', 'view', String(n), '--json', ISSUE_FIELDS], this.cwd),
    ) as RawIssue;
    return toIssue(raw);
  }
  private graphql<T>(query: string, n: number): T {
    const out = JSON.parse(
      gh(
        [
          'api',
          'graphql',
          '-F',
          'owner={owner}',
          '-F',
          'name={repo}',
          '-F',
          `n=${n}`,
          '-f',
          `query=${query}`,
        ],
        this.cwd,
      ),
    ) as { data?: { repository?: T | null } | null };
    const repo = out.data?.repository;
    if (!repo) throw new GitHubError(`gh api graphql: #${n} 응답에 repository가 없다`);
    return repo;
  }
  issueHistory(n: number): IssueHistory {
    const r = this.graphql<{
      issue?:
        (RawContent & { title: string; body: string; timelineItems?: RawRenames | null }) | null;
    }>(ISSUE_HISTORY_QUERY, n);
    if (!r.issue) throw new GitHubError(`Issue #${n}을 찾지 못했다`);
    const i = r.issue;
    // 제목 변경 필드가 없으면 불완전으로 본다(fail-closed)
    const h = toContentHistory(i, i.timelineItems ?? { totalCount: 1, nodes: [] });
    return { ...h, title: i.title, body: i.body ?? '' };
  }
  comments(n: number): Comment[] {
    const r = this.graphql<{
      issueOrPullRequest?: {
        comments?: { nodes: (RawContent & { body: string })[] } | null;
      } | null;
    }>(COMMENTS_QUERY, n);
    const nodes = r.issueOrPullRequest?.comments?.nodes;
    if (!nodes) throw new GitHubError(`#${n}의 댓글을 읽지 못했다`);
    return nodes.map((c) => ({
      author: c.author?.login ?? '',
      body: c.body,
      createdAt: c.createdAt,
      history: toContentHistory(c),
    }));
  }
  comment(n: number, body: string): void {
    gh(['api', `repos/{owner}/{repo}/issues/${n}/comments`, '-F', 'body=@-'], this.cwd, body);
  }
  prComments(n: number): { id: number; author: string; body: string }[] {
    if (!Number.isInteger(n) || n <= 0) throw new GitHubError(`PR 번호 형식 오류: ${n}`);
    // 한 줄에 댓글 하나(JSON 배열). --paginate가 마지막 페이지까지 읽고, 도중에 실패하면 gh가 실패한다
    return parseCommentRows(
      gh(
        [
          'api',
          '--paginate',
          `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`,
          '--jq',
          '.[] | [.id, .user.login, .body] | @json',
        ],
        this.cwd,
      ),
    );
  }
  addLabel(n: number, label: string): void {
    gh(['api', `repos/{owner}/{repo}/issues/${n}/labels`, '-f', `labels[]=${label}`], this.cwd);
  }
  removeLabel(n: number, label: string): void {
    try {
      gh(
        [
          'api',
          '-X',
          'DELETE',
          `repos/{owner}/{repo}/issues/${n}/labels/${encodeURIComponent(label)}`,
        ],
        this.cwd,
      );
    } catch {
      // 라벨이 없으면 무시
    }
  }
  reopenIssue(n: number): void {
    gh(['issue', 'reopen', String(n)], this.cwd);
  }
  listMyOpenPRs(): PullRequest[] {
    const raw = JSON.parse(
      gh(
        ['pr', 'list', '--author', '@me', '--state', 'open', '--limit', '100', '--json', PR_FIELDS],
        this.cwd,
      ),
    ) as RawPR[];
    return raw.map(toPR);
  }
  findPRByBranch(branch: string): PullRequest | null {
    const raw = JSON.parse(
      gh(
        ['pr', 'list', '--head', branch, '--state', 'all', '--limit', '1', '--json', PR_FIELDS],
        this.cwd,
      ),
    ) as RawPR[];
    return raw.length ? toPR(raw[0]) : null;
  }
  getPR(n: number): PullRequest | null {
    if (!Number.isInteger(n) || n <= 0) return null;
    const r = runSync('gh', ['pr', 'view', String(n), '--json', PR_FIELDS], {
      cwd: this.cwd,
      timeoutMs: 120_000,
    });
    if (r.code !== 0) {
      // 없는 번호는 null, 그 밖의 실패(인증, 네트워크)는 예외다
      if (/not found|Could not resolve|no pull requests found/i.test(r.stderr)) return null;
      throw new GitHubError(`gh pr view 실패: ${r.stderr.trim()}`);
    }
    return toPR(JSON.parse(r.stdout) as RawPR);
  }
  commitChecks(sha: string): CommitCheck[] {
    if (!COMMIT_SHA_RE.test(sha)) throw new GitHubError(`커밋 SHA 형식 오류: ${sha}`);
    // 한 줄에 항목 하나(JSON 배열)로 받는다. 페이지를 넘겨도 줄 단위로 이어진다
    const rows = <T>(pathAndQuery: string, jq: string): T[] =>
      gh(['api', '--paginate', pathAndQuery, '--jq', jq], this.cwd)
        .split('\n')
        .filter((l) => l.trim() !== '')
        .map((l) => JSON.parse(l) as T);
    const statuses = rows<RawStatusRow>(
      `repos/{owner}/{repo}/commits/${sha}/statuses?per_page=100`,
      '.[] | [.context, .state, .description, .creator.login, .target_url, .created_at] | @json',
    );
    const runs = rows<RawCheckRunRow>(
      `repos/{owner}/{repo}/commits/${sha}/check-runs?per_page=100`,
      '.check_runs[] | [.name, .status, .conclusion, .app.id, .details_url, (.completed_at // .started_at), .output.title] | @json',
    );
    return newestFirst([...statuses.map(statusToCheck), ...runs.map(checkRunToCheck)]);
  }
  createPR(p: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): PullRequest {
    const args = [
      'pr',
      'create',
      '--head',
      p.head,
      '--base',
      p.base,
      '--title',
      p.title,
      '--body-file',
      '-',
    ];
    if (p.draft) args.push('--draft');
    gh(args, this.cwd, p.body);
    const pr = this.findPRByBranch(p.head);
    if (!pr) throw new GitHubError(`PR 생성 후 조회 실패: ${p.head}`);
    return pr;
  }
  enableAutoMerge(n: number): void {
    gh(['pr', 'merge', String(n), '--auto', '--squash'], this.cwd);
  }
  setDraft(n: number, draft: boolean): void {
    gh(['pr', 'ready', String(n), ...(draft ? ['--undo'] : [])], this.cwd);
  }
}

export function getGitHub(cwd: string): GitHubPort {
  const fake = process.env.HARNESS_FAKE_GH;
  if (fake) return new FakeGitHub(fake);
  return new GhCli(cwd);
}
