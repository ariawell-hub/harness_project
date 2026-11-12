// 테스트·스모크 테스트용 가짜 GitHub. 상태를 JSON 파일에 저장해 여러 프로세스가 공유한다.
// 자동 병합을 켜면(mergeMode=immediate) 로컬 bare 원격에서 squash merge를 흉내 낸다.
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSync } from './exec.ts';
import type { Change, Comment, GitHubPort, Issue, IssueHistory, PullRequest } from './github.ts';

/**
 * 상태 파일의 댓글. `changes`가 없으면 만든 것 하나뿐이다(고친 적 없음).
 * `incomplete`는 이력을 다 읽지 못한 경우를 흉내 낸다
 */
export interface FakeComment extends Omit<Comment, 'history'> {
  changes?: Change[];
  incomplete?: boolean;
}

/** 상태 파일의 Issue. 작성자 필드가 생기기 전 상태 파일은 `author`가 없다. `changes`는 FakeComment와 같다 */
interface FakeIssue extends Omit<Issue, 'author'> {
  author?: string;
  comments: FakeComment[];
  changes?: Change[];
  incomplete?: boolean;
}

function fromFakeIssue({ comments: _c, changes: _h, incomplete: _i, ...i }: FakeIssue): Issue {
  return { ...i, author: i.author ?? '' };
}

function fromFakeComment({ changes, incomplete, ...c }: FakeComment): Comment {
  return {
    ...c,
    history: { changes: changes ?? [{ by: c.author, at: c.createdAt }], complete: !incomplete },
  };
}

/** 앞 시각보다 늘 1ms 이상 뒤의 시각. 판정이 "엄격히 뒤"를 보므로 테스트에서 시각이 겹치지 않게 한다 */
function stamp(s: FakeState): string {
  const t = Math.max(Date.now(), (s.clock ?? 0) + 1);
  s.clock = t;
  return new Date(t).toISOString();
}

interface FakePR extends PullRequest {
  base: string;
  autoMerge: boolean;
}

export interface FakeState {
  me: string;
  owner: string;
  /** 병합을 흉내 낼 bare 원격 경로 */
  remote: string;
  mergeMode: 'immediate' | 'manual';
  /** 병합 전에 PR head에 대해 실행할 CI 명령(선택). 실패하면 checks=failure */
  ciCommand?: string;
  next: number;
  /** 마지막으로 준 시각(ms). stamp()가 쓴다 */
  clock?: number;
  issues: FakeIssue[];
  prs: FakePR[];
}

export function initFakeState(file: string, s: Partial<FakeState> & { remote: string }): FakeState {
  const state: FakeState = {
    me: 'harness-bot',
    owner: 'maker',
    mergeMode: 'immediate',
    next: 1,
    issues: [],
    prs: [],
    ...s,
  };
  writeFileSync(file, JSON.stringify(state, null, 2));
  return state;
}

/** 열린 Issue를 더한다. `author`를 생략하면 제작자(상태의 `owner`)가 만든 것으로 둔다 */
export function addFakeIssue(
  file: string,
  title: string,
  body: string,
  labels: string[] = [],
  author?: string,
): number {
  const s = JSON.parse(readFileSync(file, 'utf8')) as FakeState;
  const n = s.next++;
  s.issues.push({
    number: n,
    title,
    body,
    labels,
    state: 'open',
    createdAt: stamp(s),
    author: author ?? s.owner,
    comments: [],
  });
  writeFileSync(file, JSON.stringify(s, null, 2));
  return n;
}

function git(args: string[], cwd: string): string {
  const r = runSync('git', args, { cwd });
  if (r.code !== 0) throw new Error(`[fake-gh] git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

export class FakeGitHub implements GitHubPort {
  readonly kind = 'fake' as const;
  private file: string;
  constructor(file: string) {
    this.file = file;
    if (!existsSync(file)) throw new Error(`HARNESS_FAKE_GH 상태 파일이 없다: ${file}`);
  }
  private load(): FakeState {
    return JSON.parse(readFileSync(this.file, 'utf8')) as FakeState;
  }
  private save(s: FakeState): void {
    writeFileSync(this.file, JSON.stringify(s, null, 2));
  }
  private issue(s: FakeState, n: number): FakeIssue {
    const i = s.issues.find((x) => x.number === n);
    if (i) return i;
    const pr = s.prs.find((x) => x.number === n);
    if (pr) {
      // PR도 Issue처럼 댓글·라벨을 받는다
      const shadow: FakeIssue = {
        number: n,
        title: pr.title,
        body: pr.body,
        labels: pr.labels,
        state: 'open',
        createdAt: '',
        author: '',
        comments: [],
      };
      s.issues.push({ ...shadow, state: 'closed' });
      return s.issues[s.issues.length - 1];
    }
    throw new Error(`[fake-gh] #${n} 없음`);
  }
  me(): string {
    return this.load().me;
  }
  listOpenIssues(): Issue[] {
    const s = this.load();
    const prNums = new Set(s.prs.map((p) => p.number));
    return s.issues.filter((i) => i.state === 'open' && !prNums.has(i.number)).map(fromFakeIssue);
  }
  getIssue(n: number): Issue {
    return fromFakeIssue(this.issue(this.load(), n));
  }
  issueHistory(n: number): IssueHistory {
    const i = this.issue(this.load(), n);
    return {
      title: i.title,
      body: i.body,
      changes: i.changes ?? [{ by: i.author ?? '', at: i.createdAt }],
      complete: !i.incomplete,
    };
  }
  comments(n: number): Comment[] {
    return this.issue(this.load(), n).comments.map(fromFakeComment);
  }
  comment(n: number, body: string): void {
    this.commentAs(n, this.load().me, body);
  }
  /** 테스트용: 제작자 답변 */
  ownerComment(n: number, body: string): void {
    this.commentAs(n, this.load().owner, body);
  }
  /** 테스트용: 임의 계정(외주 개발자, 대소문자가 다른 제작자 등)의 댓글 */
  commentAs(n: number, author: string, body: string): void {
    const s = this.load();
    this.issue(s, n).comments.push({ author, body, createdAt: stamp(s) });
    this.save(s);
  }
  /** 테스트용: `by` 계정이 Issue 제목·본문을 고친다(변경 이력에 남는다) */
  editIssueAs(n: number, by: string, edit: { title?: string; body?: string }): void {
    const s = this.load();
    const i = this.issue(s, n);
    i.changes ??= [{ by: i.author ?? '', at: i.createdAt }];
    if (edit.title !== undefined) i.title = edit.title;
    if (edit.body !== undefined) i.body = edit.body;
    i.changes.push({ by, at: stamp(s) });
    this.save(s);
  }
  /** 테스트용: `by` 계정이 `index`번째 댓글 본문을 고친다 */
  editCommentAs(n: number, index: number, by: string, body: string): void {
    const s = this.load();
    const c = this.issue(s, n).comments[index];
    if (!c) throw new Error(`[fake-gh] #${n} 댓글 ${index} 없음`);
    c.changes ??= [{ by: c.author, at: c.createdAt }];
    c.body = body;
    c.changes.push({ by, at: stamp(s) });
    this.save(s);
  }
  addLabel(n: number, label: string): void {
    const s = this.load();
    const i = this.issue(s, n);
    if (!i.labels.includes(label)) i.labels.push(label);
    const pr = s.prs.find((p) => p.number === n);
    if (pr && !pr.labels.includes(label)) pr.labels.push(label);
    this.save(s);
  }
  removeLabel(n: number, label: string): void {
    const s = this.load();
    const i = this.issue(s, n);
    i.labels = i.labels.filter((l) => l !== label);
    this.save(s);
  }
  reopenIssue(n: number): void {
    const s = this.load();
    this.issue(s, n).state = 'open';
    this.save(s);
  }
  listMyOpenPRs(): PullRequest[] {
    return this.load()
      .prs.filter((p) => p.state === 'open')
      .map(({ base: _b, autoMerge: _a, ...p }) => p);
  }
  findPRByBranch(branch: string): PullRequest | null {
    const list = this.load().prs.filter((p) => p.head === branch);
    if (!list.length) return null;
    const { base: _b, autoMerge: _a, ...p } = list[list.length - 1];
    return p;
  }
  createPR(p: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): PullRequest {
    const s = this.load();
    const existing = s.prs.find((x) => x.head === p.head && x.state === 'open');
    if (existing) throw new Error(`[fake-gh] ${p.head}에 열린 PR이 이미 있다`);
    const n = s.next++;
    const pr: FakePR = {
      number: n,
      title: p.title,
      body: p.body,
      head: p.head,
      base: p.base,
      state: 'open',
      isDraft: !!p.draft,
      labels: [],
      url: `fake://pr/${n}`,
      mergeState: 'CLEAN',
      checks: 'pending',
      failingChecks: [],
      autoMerge: false,
    };
    s.prs.push(pr);
    this.save(s);
    const { base: _b, autoMerge: _a, ...out } = pr;
    return out;
  }
  enableAutoMerge(n: number): void {
    const s = this.load();
    const pr = s.prs.find((p) => p.number === n);
    if (!pr) throw new Error(`[fake-gh] PR #${n} 없음`);
    pr.autoMerge = true;
    this.save(s);
    if (s.mergeMode === 'immediate') this.tryMerge(n);
  }
  /** 필수 체크(ciCommand)를 돌리고 통과하면 squash merge 한다 */
  tryMerge(n: number): boolean {
    const s = this.load();
    const pr = s.prs.find((p) => p.number === n);
    if (!pr || pr.state !== 'open' || !pr.autoMerge) return false;
    const dir = mkdtempSync(path.join(tmpdir(), 'fake-gh-merge-'));
    try {
      git(['clone', '-q', s.remote, dir], tmpdir());
      git(['config', 'user.email', 'fake@github.invalid'], dir);
      git(['config', 'user.name', 'fake-github'], dir);
      git(['checkout', '-q', pr.base], dir);
      if (s.ciCommand) {
        git(['checkout', '-q', `origin/${pr.head}`], dir);
        const r = runSync('sh', ['-c', s.ciCommand], { cwd: dir, timeoutMs: 600_000 });
        git(['checkout', '-q', pr.base], dir);
        if (r.code !== 0) {
          pr.checks = 'failure';
          pr.failingChecks = ['check'];
          this.save(s);
          return false;
        }
      }
      git(['merge', '--squash', `origin/${pr.head}`], dir);
      git(['commit', '-q', '-m', `${pr.title} (#${pr.number})`], dir);
      git(['push', '-q', 'origin', pr.base], dir);
      git(['push', '-q', 'origin', '--delete', pr.head], dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    pr.state = 'merged';
    pr.checks = 'success';
    for (const m of pr.body.matchAll(/Closes #(\d+)/g)) {
      const i = s.issues.find((x) => x.number === Number(m[1]));
      if (i) i.state = 'closed';
    }
    this.save(s);
    return true;
  }
}
