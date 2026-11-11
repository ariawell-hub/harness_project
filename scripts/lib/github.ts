// GitHub 연동 포트. 실제 구현은 gh CLI(봇 계정 GH_TOKEN, E1)를 쓰고,
// 테스트·스모크 테스트에서는 HARNESS_FAKE_GH=<상태 파일>로 가짜 구현을 쓴다(github-fake.ts).
import { runSync } from './exec.ts';
import { FakeGitHub } from './github-fake.ts';

export interface Comment {
  author: string;
  body: string;
  createdAt: string;
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
  state: 'open' | 'merged' | 'closed';
  isDraft: boolean;
  labels: string[];
  url: string;
  /** BEHIND면 main에 뒤처짐 */
  mergeState: string;
  checks: ChecksState;
  failingChecks: string[];
}

export interface GitHubPort {
  readonly kind: 'gh' | 'fake';
  me(): string;
  listOpenIssues(): Issue[];
  getIssue(n: number): Issue;
  comments(n: number): Comment[];
  comment(n: number, body: string): void;
  addLabel(n: number, label: string): void;
  removeLabel(n: number, label: string): void;
  reopenIssue(n: number): void;
  listMyOpenPRs(): PullRequest[];
  findPRByBranch(branch: string): PullRequest | null;
  createPR(p: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): PullRequest;
  enableAutoMerge(n: number): void;
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
  'number,title,body,headRefName,state,isDraft,labels,url,mergeStateStatus,statusCheckRollup';

interface RawPR {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  state: string;
  isDraft: boolean;
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
    state: r.state === 'MERGED' ? 'merged' : r.state === 'CLOSED' ? 'closed' : 'open',
    isDraft: r.isDraft,
    labels: (r.labels ?? []).map((l) => l.name),
    url: r.url,
    mergeState: r.mergeStateStatus ?? '',
    checks: s.checks,
    failingChecks: s.failing,
  };
}

const ISSUE_FIELDS = 'number,title,body,labels,state,createdAt,author';

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
  constructor(cwd: string) {
    this.cwd = cwd;
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
  comments(n: number): Comment[] {
    const raw = JSON.parse(
      gh(['api', `repos/{owner}/{repo}/issues/${n}/comments?per_page=100`], this.cwd),
    ) as { user: { login: string }; body: string; created_at: string }[];
    return raw.map((c) => ({ author: c.user.login, body: c.body, createdAt: c.created_at }));
  }
  comment(n: number, body: string): void {
    gh(['api', `repos/{owner}/{repo}/issues/${n}/comments`, '-F', 'body=@-'], this.cwd, body);
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
}

export function getGitHub(cwd: string): GitHubPort {
  const fake = process.env.HARNESS_FAKE_GH;
  if (fake) return new FakeGitHub(fake);
  return new GhCli(cwd);
}
