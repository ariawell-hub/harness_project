// L1 금지 규칙(5절 R1~R4, R10, R13, R14, R20). guard.ts가 도구 실행 직전에 호출한다.
// 반환값이 있으면 차단한다. 메시지는 "무엇이 틀렸나 + 고치는 법 + 근거"(5.1절).
import { realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_MCP_GUARD, type McpGuardConfig } from '../lib/config.ts';
import type { RepoInfo } from '../lib/git.ts';
import { PLANS_DIR, parseBranch } from '../lib/plan.ts';
import { globToRegExp, type Problem } from '../lib/util.ts';
import {
  baseName,
  commandName,
  parseSequence,
  parseShell,
  type Dialect,
  type SimpleCommand,
} from './shell.ts';

export type ToolKind = 'bash' | 'read' | 'write' | 'mcp' | 'other';

export interface GuardInput {
  kind: ToolKind;
  command?: string;
  /** 명령을 해석할 셸 방언들. 하나라도 걸리면 막는다(기본 posix, ADR-0005) */
  dialects?: Dialect[];
  /** read/write 대상 파일들 */
  files?: string[];
  /** MCP 도구의 전체 이름(`mcp__서버__도구`) */
  tool?: string;
  /** MCP 도구 입력. 객체가 아니면 해석하지 못한 호출이다 */
  input?: unknown;
  cwd: string;
}

export interface GuardContext {
  repo: RepoInfo | null;
  /** 리포에 커밋이 있는가. 없으면 부트스트랩(첫 커밋 전)이다 */
  hasCommits?: boolean;
  /** 이 worktree에 계획 id의 계획 파일이 있는가 */
  hasPlan: (root: string, id: string) => boolean;
  dbPatterns: string[];
  dbClients: string[];
  home?: string;
  tmpDirs?: string[];
  /** 경로가 속한 리포(worktree). 없으면 쓰기 대상을 세션의 리포 기준으로만 판정한다 */
  repoOf?: (abs: string) => RepoInfo | null;
  /** worktree에 있는 계획 id의 frontmatter owner */
  planOwner?: (root: string, id: string) => string | null;
  /** 현재 작업자 이름(HARNESS_WORKER, 없으면 session) */
  worker?: string;
  /**
   * 승인 요청 표시가 있는 브랜치면 표시 뒤에 더한 병합이 아닌 커밋 수. 표시가 없거나 모르면 null.
   * branch가 null이면 dir의 현재 브랜치다(Issue #78 step2)
   */
  approvalPending?: (dir: string, branch: string | null) => number | null;
  /** 브랜치 계획의 위험도(low|normal|high). 모르면 null */
  planRisk?: (dir: string, branch: string | null) => string | null;
  /** MCP 도구 규칙(`guard.mcp`). 없으면 기본값이다. 설정이 틀리면 던지고 훅이 막는다 */
  mcp?: () => McpGuardConfig;
}

const D = 'docs/harness/design.md';
const v = (rule: string, what: string, how: string, doc: string): Problem => ({
  rule,
  what,
  how,
  doc,
});

// ---------- 경로 도우미 ----------

function within(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** 심볼릭 링크(macOS /var → /private/var)를 풀어 비교한다 */
function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return real(a) === real(b);
}

function tmpRoots(ctx: GuardContext): string[] {
  return ctx.tmpDirs ?? [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
}

/** 홈 표기를 홈 경로로 바꾼다: ~, $HOME, ${HOME}, PowerShell $env:USERPROFILE, cmd %USERPROFILE% (ADR-0005) */
function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(home, p.slice(2));
  return p.replace(
    /^(\$HOME|\$\{HOME\}|\$env:USERPROFILE|\$\{env:USERPROFILE\}|%USERPROFILE%)(?=[\\/]|$)/i,
    home,
  );
}

function isEnvFile(p: string): boolean {
  // macOS·Windows 파일 시스템은 대소문자를 구분하지 않으므로 .ENV도 같은 파일이다
  const b = baseName(p.split('=').pop() ?? p).toLowerCase();
  return /^\.env(\..+)?$/.test(b) && !/^\.env\.(example|sample|template)$/.test(b);
}

// 대소문자 무시: macOS·Windows 파일 시스템은 대소문자를 구분하지 않는다
const CREDENTIAL_FILES =
  /(^|\/)(\.config\/gh\/hosts\.yml|\.git-credentials|\.netrc|\.aws\/credentials|\.codex\/auth\.json|\.claude\/\.credentials\.json|\.npmrc-auth|Library\/Keychains\/[^/]+)$/i;

/** Windows: gh 설정(%APPDATA%\GitHub CLI), 자격 증명 관리자·DPAPI 키(Microsoft\Credentials·Protect·Vault) */
const WIN_CREDENTIAL_FILES =
  /(^|\/)((appdata\/roaming|\$\{?env:appdata\}?|%appdata%)\/github cli\/hosts\.yml|(appdata\/(roaming|local)|\$\{?env:(local)?appdata\}?|%(local)?appdata%)\/microsoft\/(credentials|protect|vault)(\/.*)?)$/i;

function isCredentialFile(p: string, home: string): boolean {
  const f = expandHome(p, home).replace(/\\/g, '/');
  return CREDENTIAL_FILES.test(f) || WIN_CREDENTIAL_FILES.test(f);
}

// ---------- git ----------

const GIT_GLOBAL_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
]);

function gitSplit(argv: string[]): { configs: string[]; sub: string; args: string[] } {
  const configs: string[] = [];
  let i = 1;
  while (i < argv.length && argv[i].startsWith('-')) {
    const a = argv[i];
    if (a === '-c' || a === '--config-env') {
      configs.push(argv[i + 1] ?? '');
      i += 2;
    } else if (GIT_GLOBAL_WITH_VALUE.has(a)) i += 2;
    else i++;
  }
  return { configs, sub: argv[i] ?? '', args: argv.slice(i + 1) };
}

/** `git -C <dir>`가 가리키는 폴더. 없으면 cwd */
function gitWorkDir(argv: string[], cwd: string): string {
  let dir = cwd;
  for (let i = 1; i < argv.length && argv[i].startsWith('-'); i++) {
    if (argv[i] === '-C' && argv[i + 1]) dir = path.resolve(dir, argv[i + 1]);
    if (GIT_GLOBAL_WITH_VALUE.has(argv[i])) i++;
  }
  return dir;
}

/** push refspec의 원본 브랜치. `HEAD`나 빈 값이면 null(현재 브랜치) */
function refSource(ref: string): string | null {
  const src = ref
    .replace(/^\+/, '')
    .split(':')[0]
    .replace(/^refs\/heads\//, '');
  return src === '' || src === 'HEAD' ? null : src;
}

const APPROVAL_DOC = 'docs/harness/workflow.md 5절 "승인 요청 전 조건", AGENTS.md 작업 루프 6번';

function shortCluster(a: string, letter: string): boolean {
  return /^-[a-zA-Z]+$/.test(a) && a.slice(1).includes(letter);
}

const MAIN_REF = /^\+?(?:[^:]*:)?(?:refs\/heads\/)?(main|master)$/;

function gitRules(c: SimpleCommand, cwd: string, ctx: GuardContext): Problem | null {
  const { configs, sub, args } = gitSplit(c.argv);
  if (
    configs.some((x) => /core\.hookspath/i.test(x)) ||
    (sub === 'config' && args.some((a) => /core\.hookspath/i.test(a)))
  ) {
    return v(
      'R4 검사 우회',
      'git 훅 경로(core.hooksPath)를 바꾸려 했다',
      '훅을 끄거나 바꾸지 마라. 실패하는 검사는 원인을 고쳐라',
      `${D} R4`,
    );
  }
  if (
    args.includes('--no-verify') &&
    ['commit', 'push', 'merge', 'rebase', 'cherry-pick', 'revert', 'am', 'pull'].includes(sub)
  ) {
    return v(
      'R4 검사 우회',
      `git ${sub} --no-verify로 훅을 건너뛰려 했다`,
      '훅이 막는 원인을 고친 뒤 --no-verify 없이 다시 실행하라',
      `${D} R4`,
    );
  }
  if (sub === 'commit' && args.some((a) => shortCluster(a, 'n'))) {
    return v(
      'R4 검사 우회',
      'git commit -n(--no-verify)으로 훅을 건너뛰려 했다',
      '-n 없이 커밋하라',
      `${D} R4`,
    );
  }
  if (sub === 'credential' || sub.startsWith('credential-')) {
    return v(
      'R20 제작자 권한',
      'git 자격증명 저장소를 조회하려 했다',
      '에이전트는 봇 토큰(GH_TOKEN)만 쓴다',
      `${D} R20, E5`,
    );
  }
  if (sub === 'push') {
    const flags: string[] = [];
    const pos: string[] = [];
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === '-o' || a === '--push-option' || a === '--receive-pack' || a === '--exec') {
        i++;
        continue;
      }
      if (a.startsWith('-')) flags.push(a);
      else pos.push(a);
    }
    const force =
      flags.some(
        (f) =>
          f === '--force' ||
          f.startsWith('--force-with-lease') ||
          f === '--force-if-includes' ||
          shortCluster(f, 'f'),
      ) || pos.slice(1).some((r) => r.startsWith('+'));
    if (force) {
      return v(
        'R14 파괴적 git',
        'force push를 하려 했다',
        '이력을 덮어쓰지 마라. 되돌릴 때는 git revert로 새 커밋을 만들어라',
        `${D} R14, 14.4절`,
      );
    }
    const refs = pos.slice(1);
    const toMain =
      flags.includes('--all') ||
      flags.includes('--mirror') ||
      refs.some((r) => MAIN_REF.test(r)) ||
      (refs.length === 0 && ctx.repo !== null && /^(main|master)$/.test(ctx.repo.branch));
    if (toMain) {
      return v(
        'R2 main 보호',
        'main(또는 master)에 직접 push하려 했다',
        '작업 브랜치에서 push하고 PR을 열어라. 브랜치·worktree는 `node scripts/harness.ts new-task`가 만든다',
        `${D} R2`,
      );
    }
    if (ctx.approvalPending) {
      const dir = gitWorkDir(c.argv, cwd);
      for (const branch of refs.length ? refs.map(refSource) : [null]) {
        const extra = ctx.approvalPending(dir, branch);
        if (extra) {
          return v(
            '승인 요청 뒤 push',
            `승인을 요청한 PR 브랜치(${branch ?? '현재 브랜치'})에 새 커밋 ${extra}개를 push하려 했다. head가 바뀌면 승인이 철회된다`,
            '미룰 수 있는 변경은 다음 PR에 넣어라. 꼭 올려야 하면 제작자에게 먼저 알리고 ' +
              '`node scripts/harness.ts pr-ready --undo`로 승인 요청을 거둔 뒤 push하고, 끝나면 `pr-ready`로 다시 요청하라. ' +
              'main 병합 갱신(병합 커밋만 더함)은 막지 않는다',
            APPROVAL_DOC,
          );
        }
      }
    }
  }
  if (sub === 'add' && args.some((a) => a === '--force' || shortCluster(a, 'f'))) {
    return v(
      'R10 시크릿',
      'git add -f로 무시된 파일(.env 등)을 강제로 올리려 했다',
      '.gitignore된 파일은 커밋하지 마라. 예시 값은 .env.example에 둔다',
      `${D} R10`,
    );
  }
  if (sub === 'reset' && args.includes('--hard')) {
    return v(
      'R14 파괴적 git',
      'git reset --hard는 커밋하지 않은 변경을 지운다',
      '되돌릴 때는 git revert, 일부 파일은 명시적으로 고쳐라',
      `${D} R14, 14.4절`,
    );
  }
  if (
    sub === 'clean' &&
    args.some((a) => a === '--force' || shortCluster(a, 'f')) &&
    !args.some((a) => a === '--dry-run' || shortCluster(a, 'n'))
  ) {
    return v(
      'R14 파괴적 git',
      'git clean -f는 추적하지 않는 파일을 지운다',
      '지울 파일을 하나씩 지정하거나, 표준 명령의 정리 작업을 써라',
      `${D} R14`,
    );
  }
  if (sub === 'checkout' || sub === 'restore') {
    const dd = args.indexOf('--');
    const paths = dd >= 0 ? args.slice(dd + 1) : args.filter((a) => !a.startsWith('-'));
    const wide = paths.some((p) => p === '.' || p === ':/' || p === '*' || p === './');
    const stagedOnly =
      sub === 'restore' &&
      args.includes('--staged') &&
      !args.includes('--worktree') &&
      !args.includes('-W');
    if (
      (wide && !stagedOnly) ||
      (sub === 'checkout' && args.some((a) => a === '-f' || a === '--force'))
    ) {
      return v(
        'R14 파괴적 git',
        `git ${sub}로 커밋하지 않은 변경 전체를 지우려 했다`,
        '되돌릴 파일을 하나씩 지정하라',
        `${D} R14, 14.4절`,
      );
    }
  }
  if (
    sub === 'branch' &&
    args.some(
      (a) => a === '-D' || (a === '--delete' && args.includes('--force')) || /^-[a-zA-Z]*D/.test(a),
    )
  ) {
    return v(
      'R14 파괴적 git',
      'git branch -D로 브랜치를 강제 삭제하려 했다',
      '병합된 worktree·브랜치 정리는 `node scripts/harness.ts start`가 한다',
      `${D} R14`,
    );
  }
  if (
    sub === 'worktree' &&
    args[0] === 'remove' &&
    args.some((a) => a === '--force' || a === '-f')
  ) {
    return v(
      'R14 파괴적 git',
      'worktree를 강제로 지우려 했다',
      '정리는 `node scripts/harness.ts start`에 맡겨라',
      `${D} R14`,
    );
  }
  if (
    sub === 'filter-branch' ||
    sub === 'filter-repo' ||
    (sub === 'update-ref' && args.includes('-d'))
  ) {
    return v(
      'R14 파괴적 git',
      `git ${sub}로 이력을 재작성하려 했다`,
      '이력 재작성은 14.5절 예외 절차로 제작자가 한다',
      `${D} R14, 14.5절`,
    );
  }
  return null;
}

// ---------- gh ----------

const SENSITIVE_API =
  /(?:^|\/)(?:branches\/[^/]+\/protection|rulesets|environments|actions\/(?:secrets|variables|permissions|runners)|dependabot\/secrets|codespaces\/secrets|collaborators|invitations|keys|hooks|autolinks|teams|installation|pulls\/\d+\/reviews|actions\/workflows\/[^/]+\/disable)(?:\/|$|\?)/;

function ghRules(c: SimpleCommand, cwd: string, ctx: GuardContext): Problem | null {
  const a = c.argv.slice(1);
  const [g1, g2] = a;
  const r20 = (what: string) =>
    v(
      'R20 제작자 권한',
      what,
      '에이전트는 승인·보호 설정·시크릿·계정 전환을 할 수 없다. 필요하면 needs-human으로 제작자에게 요청하라(9.1절)',
      `${D} R20, 10.4절`,
    );
  if (g1 === 'pr' && g2 === 'review' && a.some((x) => x === '--approve' || x === '-a'))
    return r20('gh pr review --approve로 PR을 승인하려 했다');
  if (g1 === 'pr' && g2 === 'merge' && a.includes('--admin'))
    return r20('gh pr merge --admin으로 브랜치 보호를 우회하려 했다');
  if (g1 === 'auth' && ['login', 'logout', 'switch', 'refresh', 'setup-git', 'token'].includes(g2))
    return r20(`gh auth ${g2}로 계정·토큰을 바꾸거나 꺼내려 했다`);
  if (g1 === 'secret' && g2 !== 'list') return r20(`gh secret ${g2 ?? ''}로 시크릿을 바꾸려 했다`);
  if (g1 === 'variable' && ['set', 'delete'].includes(g2))
    return r20(`gh variable ${g2}로 Actions 변수를 바꾸려 했다`);
  if (
    g1 === 'repo' &&
    ['edit', 'delete', 'rename', 'archive', 'unarchive', 'deploy-key'].includes(g2)
  )
    return r20(`gh repo ${g2}로 리포 설정을 바꾸려 했다`);
  if (g1 === 'workflow' && g2 === 'disable')
    return v(
      'R4 검사 우회',
      'CI 워크플로를 끄려 했다',
      '검사를 끄지 말고 원인을 고쳐라',
      `${D} R4`,
    );
  if (g1 === 'api') {
    let method = 'GET';
    let endpoint = '';
    let hasFields = false;
    for (let i = 1; i < a.length; i++) {
      const x = a[i];
      if (x === '-X' || x === '--method') {
        method = (a[i + 1] ?? 'GET').toUpperCase();
        i++;
      } else if (x.startsWith('--method=')) method = x.slice(9).toUpperCase();
      else if (/^-X[A-Za-z]+$/.test(x)) method = x.slice(2).toUpperCase();
      else if (['-f', '-F', '--field', '--raw-field', '--input'].includes(x)) {
        hasFields = true;
        i++;
      } else if (
        [
          '-H',
          '--header',
          '-q',
          '--jq',
          '-t',
          '--template',
          '--hostname',
          '--cache',
          '-p',
          '--preview',
        ].includes(x)
      )
        i++;
      else if (!x.startsWith('-') && !endpoint) endpoint = x.replace(/^\//, '');
    }
    if (method === 'GET' && hasFields) method = 'POST';
    if (endpoint === 'graphql') {
      const body = a.join(' ');
      if (
        /mutation/i.test(body) &&
        /(PullRequestReview|BranchProtection|Ruleset|updateRepository|deleteRepository|Environment|addCollaborator|updateTeam|Secret)/i.test(
          body,
        )
      ) {
        return r20('GraphQL mutation으로 승인·보호 설정을 바꾸려 했다');
      }
      return null;
    }
    if (method !== 'GET' && method !== 'HEAD') {
      if (SENSITIVE_API.test(endpoint))
        return r20(`gh api ${method} ${endpoint}로 보호 설정·시크릿·승인을 바꾸려 했다`);
      if (/^repos\/[^/]+\/[^/]+\/?$/.test(endpoint) && method !== 'POST')
        return r20(`gh api ${method} ${endpoint}로 리포 설정을 바꾸려 했다`);
    }
  }
  if (g1 === 'pr' && g2 === 'ready') {
    return v(
      '승인 요청 순서',
      'gh pr ready를 직접 실행하려 했다. 초안 해제는 승인 요청이라 조건 확인이 먼저다',
      'worktree 안에서 `node scripts/harness.ts pr-ready`를 써라(완료 처리·push·main 병합을 확인하고 초안을 해제한다). ' +
        '초안으로 되돌릴 때는 `node scripts/harness.ts pr-ready --undo`',
      APPROVAL_DOC,
    );
  }
  if (g1 === 'pr' && g2 === 'create' && ctx.planRisk) {
    let head: string | null = null;
    let draft = false;
    for (let i = 2; i < a.length; i++) {
      const x = a[i];
      if (x === '--head' || x === '-H') head = a[++i] ?? null;
      else if (x.startsWith('--head=')) head = x.slice(7);
      else if (x === '--draft' || x === '-d') draft = true;
    }
    if (!draft && ctx.planRisk(cwd, head) === 'high') {
      return v(
        '승인 요청 순서',
        '위험도 높음 계획의 PR을 초안이 아닌 상태로 만들려 했다. 만들자마자 승인 요청이 된다',
        '`gh pr create --draft`로 올리고, 끝난 뒤 `node scripts/harness.ts pr-ready`로 초안을 해제하라',
        APPROVAL_DOC,
      );
    }
  }
  return null;
}

// ---------- DB (R13) ----------

const DB_CLIENTS = [
  'psql',
  'mysql',
  'mariadb',
  'mongosh',
  'mongo',
  'redis-cli',
  'pg_restore',
  'mysqlimport',
  'cqlsh',
  'sqlcmd',
  'clickhouse-client',
  'dropdb',
];

const DB_PATTERNS: RegExp[] = [
  /\bdrop\s+(database|schema|table|column|index|constraint|view|collection)\b/i,
  /\btruncate\s+(?!-)(table\s+)?["`\w.]+/i,
  /\bdelete\s+from\b/i,
  /\bupdate\s+["`\w.]+\s+set\b(?![\s\S]*\bwhere\b)/i,
  /\balter\s+table\b[\s\S]*\bdrop\b/i,
  /\bprisma\s+(db\s+push|migrate\s+reset)\b/i,
  /--accept-data-loss\b/,
  /--force-reset\b/,
  /\bdrizzle-kit\s+push\b/i,
  /\b(migrate:fresh|migrate:reset|db:drop|db:reset|schema:drop|schema:sync|db:wipe)\b/i,
  /\bdropDatabase\s*\(/,
  /\bflushall\b|\bflushdb\b/i,
];

function dbRules(c: SimpleCommand, ctx: GuardContext): Problem | null {
  const clients = new Set([...DB_CLIENTS, ...ctx.dbClients]);
  const hit = c.argv.find((x) => clients.has(commandName(x)));
  if (hit) {
    return v(
      'R13 DB 위험 작업',
      `DB 클라이언트(${commandName(hit)})로 직접 접속하려 했다`,
      '일회용 DB는 표준 명령(setup·test·dev)으로만 쓴다. 공유·운영 DB 작업은 9.1절로 제작자에게 요청하라',
      `${D} R13, 14.3절`,
    );
  }
  const text = c.argv.join(' ');
  const pats = [...DB_PATTERNS, ...ctx.dbPatterns.map((p) => new RegExp(p, 'i'))];
  const p = pats.find((re) => re.test(text));
  if (p) {
    return v(
      'R13 DB 위험 작업',
      `금지된 DB 작업을 실행하려 했다: ${text.slice(0, 160)}`,
      '데이터 삭제·스키마 파괴·스키마 diff 자동 적용은 에이전트가 실행하지 않는다. 마이그레이션 파일로 작성하면 위험도 높음 + 제작자 승인으로 처리된다',
      `${D} R13, 14.3절`,
    );
  }
  return null;
}

// ---------- 파괴적 명령·운영 작용 (R14) ----------

/** Windows 삭제 명령: PowerShell Remove-Item과 별칭, cmd rd·rmdir·del·erase (ADR-0005) */
const WIN_RM = new Set(['remove-item', 'ri', 'del', 'erase', 'rd', 'rmdir']);

/** 삭제 명령이면 재귀 여부와 대상을 돌려준다. windows는 대상이 없어도(파이프 입력) 막아야 하는 형태 */
function rmTargets(
  c: SimpleCommand,
): { recursive: boolean; targets: string[]; windows: boolean } | null {
  const head = commandName(c.argv[0]);
  const args = c.argv.slice(1);
  if (head === 'rm') {
    const dd = args.indexOf('--');
    const flags = (dd >= 0 ? args.slice(0, dd) : args).filter((a) => a.startsWith('-'));
    return {
      recursive: flags.some((f) => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f)),
      targets:
        dd >= 0
          ? [...args.slice(0, dd).filter((a) => !a.startsWith('-')), ...args.slice(dd + 1)]
          : args.filter((a) => !a.startsWith('-')),
      windows: false,
    };
  }
  if (!WIN_RM.has(head)) return null;
  // PowerShell -Recurse(접두 약어 -r, -rec …) 또는 cmd /s. POSIX rmdir(-p 등)은 재귀가 아니다
  const isSwitch = (a: string) => a.startsWith('-') || /^\/[a-z]$/i.test(a);
  return {
    recursive: args.some((a) => /^-r(e(c(u(r(s(e)?)?)?)?)?)?(:.*)?$/i.test(a) || /^\/s$/i.test(a)),
    targets: args
      .filter((a) => !isSwitch(a))
      .flatMap((a) => a.split(','))
      .map((a) => a.trim().replace(/\\/g, '/'))
      .filter(Boolean),
    windows: true,
  };
}

function rmRule(c: SimpleCommand, cwd: string, ctx: GuardContext): Problem | null {
  const rm = rmTargets(c);
  if (!rm || !rm.recursive) return null;
  const { targets } = rm;
  const home = ctx.home ?? homedir();
  const root = ctx.repo?.root ?? null;
  const bad = (what: string) =>
    v(
      'R14 파괴적 명령',
      what,
      '지울 대상을 worktree 안의 구체적인 경로로 지정하라. 리포 정리는 표준 명령이 한다',
      `${D} R14, 14.4절`,
    );
  if (rm.windows && targets.length === 0)
    return bad('재귀 삭제 대상을 경로로 적지 않았다(파이프로 받은 대상은 판정할 수 없다)');
  for (const t of targets) {
    const e = expandHome(t, home);
    if (/\$|`|…|%[^%\s]+%/.test(e)) return bad(`재귀 삭제 대상에 해석할 수 없는 변수가 있다: ${t}`);
    const abs = path.resolve(cwd, e);
    if (abs === path.parse(abs).root || abs === home || within(home, abs))
      return bad(`루트·홈을 재귀 삭제하려 했다: ${t}`);
    if (root && (within(abs, root) || within(root, abs))) {
      // 리포 판정이 임시 폴더 허용보다 먼저다(리포가 임시 폴더 안에 있어도 루트 삭제는 막는다)
      if (abs === root || within(root, abs) || (t.includes('*') && path.dirname(abs) === root))
        return bad(`리포 루트 전체를 재귀 삭제하려 했다: ${t}`);
      if (path.relative(root, abs).split(path.sep)[0] === '.git')
        return bad(`git 메타데이터를 지우려 했다: ${t}`);
      continue;
    }
    if (tmpRoots(ctx).some((d) => within(abs, d) && abs !== d)) continue;
    if (!root) return bad(`리포 밖을 재귀 삭제하려 했다: ${t}`);
    return bad(`worktree 밖을 재귀 삭제하려 했다: ${t}`);
  }
  return null;
}

function externalRules(c: SimpleCommand): Problem | null {
  const a = c.argv;
  const head = commandName(a[0]);
  const has = (x: string) => a.includes(x);
  const deploy = (what: string) =>
    v(
      'R14 운영·외부 작용',
      what,
      '운영 배포·인프라 변경·외부 발송은 사람이 실행한다. 필요하면 9.1절로 요청하라',
      `${D} R14, 14.4절`,
    );
  if (head === 'terraform' && (has('destroy') || (has('apply') && has('-destroy'))))
    return deploy('terraform destroy로 인프라를 지우려 했다');
  if ((head === 'pulumi' || head === 'cdk') && has('destroy'))
    return deploy(`${head} destroy로 인프라를 지우려 했다`);
  if (head === 'kubectl' && (has('delete') || has('drain')))
    return deploy('kubectl로 클러스터 리소스를 지우려 했다');
  if (head === 'helm' && (has('uninstall') || has('delete')))
    return deploy('helm으로 릴리스를 지우려 했다');
  if (head === 'aws' && a.some((x) => /^(delete-|terminate-|rb$|rm$)/.test(x)))
    return deploy('aws CLI로 클라우드 리소스를 지우려 했다');
  if ((head === 'gcloud' || head === 'az') && has('delete'))
    return deploy(`${head}로 클라우드 리소스를 지우려 했다`);
  if (head === 'vercel' && (has('--prod') || has('--production')))
    return deploy('vercel 운영 배포를 하려 했다');
  if (head === 'netlify' && has('deploy') && has('--prod'))
    return deploy('netlify 운영 배포를 하려 했다');
  if ((head === 'fly' || head === 'flyctl') && (has('deploy') || has('destroy')))
    return deploy(`${head} 배포·삭제를 하려 했다`);
  if (head === 'firebase' && has('deploy')) return deploy('firebase 배포를 하려 했다');
  if (['npm', 'pnpm', 'yarn'].includes(head) && has('publish'))
    return deploy('패키지를 공개 레지스트리에 게시하려 했다');
  if (['sendmail', 'mail', 'mailx'].includes(head)) return deploy('메일을 발송하려 했다');
  if (
    ['curl', 'wget', 'http', 'nc'].includes(head) &&
    a.some((x) => /169\.254\.169\.254|metadata\.google\.internal/.test(x))
  ) {
    return deploy('클라우드 메타데이터 주소에 접속하려 했다');
  }
  return null;
}

// ---------- 시크릿·자격증명 (R10, R20) ----------

const TOKEN_VARS = [
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'GITHUB_ENTERPRISE_TOKEN',
  'GH_CONFIG_DIR',
];
const ENV_READ_EXEMPT = new Set(['ls', 'test', '[', 'git', 'touch', 'stat']);

/** 토큰 변수 이름이면 정식 이름을 돌려준다. Windows 환경 변수는 대소문자를 구분하지 않는다 */
function tokenVar(name: string): string | undefined {
  return TOKEN_VARS.find((t) => t.toLowerCase() === name.toLowerCase());
}

/** PowerShell Env: 드라이브를 바꾸는 명령(Remove-Item Env:GH_TOKEN 등)과 별칭 */
const PS_ENV_ITEM = new Set([
  'remove-item',
  'ri',
  'rm',
  'del',
  'erase',
  'set-item',
  'si',
  'clear-item',
  'cli',
  'new-item',
  'ni',
  'rename-item',
  'rni',
  'move-item',
  'mi',
  'mv',
]);

/**
 * Windows 형태의 토큰 변수 변경: PowerShell `$env:GH_TOKEN = …`, `Remove-Item Env:GH_TOKEN`,
 * cmd `set GH_TOKEN=…`, `setx GH_TOKEN …` (ADR-0005). 읽기(`echo $env:GH_TOKEN`)는 막지 않는다.
 */
function windowsTokenChange(c: SimpleCommand): string | undefined {
  const [a0 = '', a1 = ''] = c.argv;
  const ps = /^\$\{?env:([A-Za-z_]\w*)\}?(\s*\+?=.*)?$/i.exec(a0);
  if (ps && (ps[2] !== undefined || /^\+?=/.test(a1))) return tokenVar(ps[1]);
  const head = commandName(a0);
  if (PS_ENV_ITEM.has(head)) {
    for (const x of c.argv.slice(1)) {
      const m = /^env:[\\/]?([A-Za-z_]\w*)$/i.exec(x);
      const t = m && tokenVar(m[1]);
      if (t) return t;
    }
  }
  if (head === 'set' || head === 'setx') {
    for (const x of c.argv.slice(1)) {
      const t = tokenVar(x.replace(/^"/, '').split('=')[0]);
      if (t) return t;
    }
  }
  return undefined;
}

/** OS 자격증명 저장소를 다루는 명령(macOS security는 아래에서 따로) */
const CREDENTIAL_TOOLS = new Set(['cmdkey', 'vaultcmd', 'get-storedcredential']);

/** 명령 원문에서 찾는 Windows 자격증명 API와 토큰 변수 변경(.NET 호출은 단순 명령으로 나뉘지 않는다) */
const RAW_WIN_CREDENTIAL =
  /\b(PasswordVault|CredRead\w*|CredEnumerate\w*|Get-StoredCredential)\b|ProtectedData\]?::Unprotect/i;
const RAW_SET_ENV = new RegExp(
  `SetEnvironmentVariable\\s*\\(\\s*['"]?(${TOKEN_VARS.join('|')})\\b`,
  'i',
);

function rawRules(command: string): Problem | null {
  const api = RAW_WIN_CREDENTIAL.exec(command);
  if (api) {
    return v(
      'R20 제작자 권한',
      `Windows 자격 증명 저장소에 접근하려 했다(${api[0]})`,
      '에이전트는 OS 자격증명 저장소에 접근하지 않는다. 봇 토큰(GH_TOKEN)만 쓴다',
      `${D} R20, E5`,
    );
  }
  const env = RAW_SET_ENV.exec(command);
  if (env) {
    return v(
      'R20 제작자 권한',
      `${env[1]}를 바꾸거나 해제하려 했다(SetEnvironmentVariable)`,
      '에이전트 세션은 시작할 때 받은 봇 토큰만 쓴다',
      `${D} R20, E5`,
    );
  }
  return null;
}

function secretRules(c: SimpleCommand, ctx: GuardContext): Problem | null {
  const home = ctx.home ?? homedir();
  const tokenChange =
    Object.keys(c.assigns).map(tokenVar).find(Boolean) ??
    c.unsets.map(tokenVar).find(Boolean) ??
    windowsTokenChange(c);
  if (tokenChange) {
    return v(
      'R20 제작자 권한',
      `${tokenChange}를 바꾸거나 해제하려 했다`,
      '에이전트 세션은 시작할 때 받은 봇 토큰만 쓴다',
      `${D} R20, E5`,
    );
  }
  if (!c.argv.length) return null;
  const head = commandName(c.argv[0]);
  if (head === 'security' && /^(find-|dump-|export|unlock-keychain)/.test(c.argv[1] ?? '')) {
    return v(
      'R20 제작자 권한',
      `macOS 키체인을 조회하려 했다(security ${c.argv[1]})`,
      '에이전트는 키체인에 접근하지 않는다',
      `${D} R20, E5`,
    );
  }
  if (CREDENTIAL_TOOLS.has(head) || head.startsWith('git-credential')) {
    return v(
      'R20 제작자 권한',
      `OS 자격증명 저장소를 조회·변경하려 했다(${c.argv[0]})`,
      '에이전트는 Windows 자격 증명 관리자·git 자격증명 도우미에 접근하지 않는다. 봇 토큰(GH_TOKEN)만 쓴다',
      `${D} R20, E5`,
    );
  }
  const cred = c.argv.slice(1).find((x) => isCredentialFile(x, home));
  if (cred) {
    return v(
      'R20 제작자 권한',
      `자격증명 파일에 접근하려 했다: ${cred}`,
      '에이전트는 봇 토큰(GH_TOKEN)만 쓴다',
      `${D} R20, E5`,
    );
  }
  if (!ENV_READ_EXEMPT.has(head)) {
    const env = c.argv.slice(1).find((x) => !x.startsWith('-') && isEnvFile(x));
    if (env) {
      return v(
        'R10 시크릿',
        `.env 파일에 접근하려 했다: ${env}`,
        '.env 값은 읽지 마라. 필요한 키 이름은 .env.example을 보라',
        `${D} R10, 14.2절`,
      );
    }
  }
  return null;
}

// ---------- 검사 순서 (R4, TD-29) ----------

/** `node …/scripts/harness.ts <sub>`의 sub. 하네스 명령이 아니면 null */
function harnessSub(c: SimpleCommand): string | null {
  if (!c.argv.length || commandName(c.argv[0]) !== 'node') return null;
  const k = c.argv.findIndex((a, i) => i > 0 && /(?:^|[\\/])harness\.ts$/.test(a));
  return k > 0 ? (c.argv[k + 1] ?? null) : null;
}

function isCheckCommand(c: SimpleCommand): boolean {
  const sub = harnessSub(c);
  return sub === 'check' || sub === 'test';
}

/** 검사가 통과한 뒤에만 실행돼야 하는 작업의 이름. 아니면 null */
function followUp(c: SimpleCommand): string | null {
  const sub = harnessSub(c);
  if (sub === 'complete-step' || sub === 'pr-ready') return sub;
  if (!c.argv.length) return null;
  const head = commandName(c.argv[0]);
  if (head === 'git' && gitSplit(c.argv).sub === 'push') return 'git push';
  if (head === 'gh' && c.argv[1] === 'pr' && (c.argv[2] === 'create' || c.argv[2] === 'ready'))
    return `gh pr ${c.argv[2]}`;
  return null;
}

/** `set -e`, `set -eu`, `set -o errexit`, `set -o pipefail` 같은 셸 옵션 */
function setOptions(c: SimpleCommand): { errexit: boolean; pipefail: boolean } {
  const none = { errexit: false, pipefail: false };
  if (!c.argv.length || c.argv[0] !== 'set') return none;
  const a = c.argv.slice(1);
  return {
    errexit: a.some(
      (x, i) =>
        (/^-[a-zA-Z]+$/.test(x) && x.includes('e')) ||
        (x === 'errexit' && /^-[a-zA-Z]*o$/.test(a[i - 1] ?? '')),
    ),
    pipefail: a.some((x, i) => x === 'pipefail' && /^-[a-zA-Z]*o$/.test(a[i - 1] ?? '')),
  };
}

const CHECK_HOW =
  '검사 결과는 종료 코드로 이어라. 출력은 파일로 보낸다: ' +
  '`node scripts/harness.ts check > check.log 2>&1 && <다음 명령>`. ' +
  '출력을 줄여 보려면 앞에 `set -o pipefail`을 둔다';

/**
 * 검사 명령(`harness.ts check`·`test`)의 실패가 가려지는 꼴을 막는다(절차서 4절, TD-29).
 * 1. 출력 가림: 검사 명령 바로 뒤가 파이프인데 `set -o pipefail`이 없다.
 * 2. 실패 뒤 진행: 검사 명령과 그 뒤 완료 처리·push·PR 생성 사이가 `&&`로만 이어지지 않았다(`set -e`가 없을 때).
 */
function sequenceRules(command: string): Problem | null {
  let errexit = false;
  let pipefail = false;
  let checked = false; // 검사 명령이 앞에 있었다
  let broken = false; // 그 뒤 `&&`가 아닌 연산자로 이어진 적이 있다
  for (const { cmd, next } of parseSequence(command, 'posix')) {
    const opts = setOptions(cmd);
    errexit ||= opts.errexit;
    pipefail ||= opts.pipefail;
    const isCheck = isCheckCommand(cmd);
    const piped = next === '|' || next === '|&';
    if (isCheck && piped && !pipefail) {
      return v(
        'R4 검사 우회',
        '검사 명령의 출력을 파이프로 넘겼다. 파이프의 종료 코드는 마지막 명령의 것이라 검사가 실패해도 통과로 보인다',
        CHECK_HOW,
        'docs/harness/workflow.md 4절, TD-29',
      );
    }
    const what = followUp(cmd);
    if (what && checked && broken && !errexit) {
      return v(
        'R4 검사 우회',
        `검사 명령 뒤에 \`&&\`가 아닌 연산자(\`;\`·줄바꿈·\`||\`·\`&\`)를 거쳐 ${what}이(가) 이어진다. 검사가 실패해도 실행된다`,
        CHECK_HOW,
        'docs/harness/workflow.md 4절, TD-29',
      );
    }
    if (isCheck) checked = true;
    // pipefail이 켜진 파이프는 검사의 종료 코드를 그대로 넘긴다
    if (checked && next !== null && next !== '&&' && !piped) broken = true;
  }
  return null;
}

// ---------- 진입점 ----------

export function evaluateBash(
  command: string,
  cwd: string,
  ctx: GuardContext,
  dialect: Dialect = 'posix',
): Problem | null {
  const raw = rawRules(command);
  if (raw) return raw;
  let procedural: Problem | null = null;
  for (const c of parseShell(command, dialect)) {
    const head = c.argv.length ? commandName(c.argv[0]) : '';
    const r =
      secretRules(c, ctx) ??
      (head === 'git' ? gitRules(c, cwd, ctx) : null) ??
      (head === 'gh' ? ghRules(c, cwd, ctx) : null) ??
      (c.argv.length ? dbRules(c, ctx) : null) ??
      (c.argv.length ? rmRule(c, cwd, ctx) : null) ??
      (c.argv.length ? externalRules(c) : null);
    // 금지 규칙(R…)이 먼저다. 승인 요청 순서 같은 절차 안내는 뒤 명령의 금지 규칙과 검사 순서 규칙을 가리지 않는다
    if (r && /^R\d/.test(r.rule)) return r;
    procedural ??= r;
  }
  return (dialect === 'posix' ? sequenceRules(command) : null) ?? procedural;
}

/**
 * 같은 리포의 다른 worktree에 쓸 때의 R3 판정. 허용하면 null(이후 그 worktree 기준으로 R1을 본다).
 * - 대상이 main 체크아웃: null을 돌려 main 체크아웃 판정에 맡긴다
 * - 세션이 작업 worktree 안: 다른 worktree는 막는다(작업 간 간섭 방지)
 * - 세션이 main 체크아웃: 대상 계획의 owner가 현재 작업자일 때만 허용. 모르면 막는다(fail-closed)
 */
function otherWorktreeProblem(cur: RepoInfo, target: RepoInfo, ctx: GuardContext): Problem | null {
  if (target.isMainCheckout) return null;
  if (!cur.isMainCheckout) {
    return v(
      'R3 worktree',
      `다른 작업 worktree의 파일을 수정하려 했다: ${target.root}`,
      '지금 worktree의 작업만 한다. 다른 작업은 그 worktree에서 한다',
      `${D} R3`,
    );
  }
  const b = parseBranch(target.branch);
  const owner = b ? (ctx.planOwner?.(target.root, b.id) ?? null) : null;
  const worker = ctx.worker ?? 'session';
  if (owner === worker) return null;
  return v(
    'R3 worktree',
    owner
      ? `${owner}의 작업 worktree 파일을 수정하려 했다: ${target.root}`
      : `계획(owner)을 확인할 수 없는 worktree의 파일을 수정하려 했다: ${target.root}`,
    `main 체크아웃의 대화 세션은 자기 계획(owner가 ${worker})의 worktree만 고친다. ` +
      '`new-task`로 만든 worktree인지 확인하고, 다른 작업자의 것을 넘겨받으려면 제작자에게 묻는다',
    `${D} R3`,
  );
}

export function evaluateFile(
  kind: 'read' | 'write',
  file: string,
  cwd: string,
  ctx: GuardContext,
): Problem | null {
  const home = ctx.home ?? homedir();
  const abs = path.resolve(cwd, expandHome(file, home));
  if (isCredentialFile(abs, home)) {
    return v(
      'R20 제작자 권한',
      `자격증명 파일에 접근하려 했다: ${file}`,
      '에이전트는 봇 토큰만 쓴다',
      `${D} R20, E5`,
    );
  }
  if (isEnvFile(abs)) {
    return v(
      'R10 시크릿',
      `.env 파일에 접근하려 했다: ${file}`,
      '.env는 읽거나 고치지 마라. 예시 값은 .env.example에 둔다',
      `${D} R10, 14.2절`,
    );
  }
  if (kind === 'read') return null;
  const cur = ctx.repo;
  if (!cur) return null;
  // 쓰기 대상이 같은 리포의 다른 worktree면 그 worktree 기준으로 판정한다(Issue #16).
  // main 체크아웃에서 시작한 대화 세션이 EnterWorktree(사람 승인) 없이 자기 작업 worktree를 고치게 한다.
  let repo = cur;
  const target = ctx.repoOf?.(abs) ?? null;
  if (target && samePath(target.commonDir, cur.commonDir) && !samePath(target.root, cur.root)) {
    const p = otherWorktreeProblem(cur, target, ctx);
    if (p) return p;
    repo = target;
  } else if (!within(abs, cur.root)) {
    // 리포 밖이라도 임시 폴더와 Claude 계획 파일은 허용한다
    if (tmpRoots(ctx).some((d) => within(abs, d))) return null;
    if (within(abs, path.join(home, '.claude', 'plans'))) return null;
    // 사용자 환경(셸 프로필, 토큰 파일 등)이나 다른 프로젝트다. worktree 이야기를 하면 혼란을 준다(Issue #16)
    return v(
      'R3 worktree',
      `리포 밖 파일을 수정하려 했다: ${abs}`,
      '리포 밖(사용자 환경·다른 프로젝트) 파일은 에이전트가 고치지 않는다. ' +
        '바꿀 내용과 사용자가 직접 실행할 명령("! <명령>")을 안내하라',
      `${D} R3`,
    );
  }
  // 부트스트랩 예외: 첫 커밋 전에는 worktree를 만들 수 없다(git worktree add에 기준 커밋이 필요).
  // 하네스 템플릿 자체를 처음 세울 때만 해당하며, 첫 커밋 뒤에는 사라진다.
  if (repo.isMainCheckout && ctx.hasCommits === false) return null;
  if (repo.isMainCheckout) {
    return v(
      'R3 worktree',
      `main 체크아웃의 파일을 수정하려 했다: ${path.relative(repo.root, abs)}`,
      '`node scripts/harness.ts new-task --issue <N> --slug <이름>`으로 worktree를 만들고 그 안에서 작업하라',
      `${D} R3, 4.2절`,
    );
  }
  const rel = path.relative(repo.root, abs).replace(/\\/g, '/');
  if (rel.startsWith(PLANS_DIR + '/')) return null;
  const b = parseBranch(repo.branch);
  if (!b) {
    return v(
      'R1 계획 필수',
      `브랜치 이름(${repo.branch})이 계획 규칙(<type>/<id>-s<N>)과 다르다`,
      '`node scripts/harness.ts new-task`로 브랜치·worktree·계획을 함께 만들어라',
      `${D} R1, 8.1절`,
    );
  }
  if (!ctx.hasPlan(repo.root, b.id)) {
    return v(
      'R1 계획 필수',
      `계획 파일(${PLANS_DIR}/active/${b.id})이 없는데 코드를 고치려 했다`,
      '먼저 계획을 작성하라(docs/harness/workflow.md "계획 작성")',
      `${D} R1, 4.2절`,
    );
  }
  return null;
}

// ---------- MCP 도구 (13.1절, TD-13) ----------

/** 브라우저 도구 입력을 들여다보는 상한. 넘으면 판단하지 못한 것이므로 막는다 */
const MCP_MAX_DEPTH = 16;
const MCP_MAX_CHARS = 2_000_000;

const globAny = (text: string, globs: string[]): boolean =>
  globs.some((g) => new RegExp(globToRegExp(g).source, 'i').test(text));

/** 도구 이름(서버 접두어 뒤)의 단어들. `_`·`-`와 대소문자·숫자 경계로 나눈다: `untrash`는 `trash`와 다른 단어다 */
function mcpWords(tool: string): string[] {
  const rest = tool.replace(/^mcp__/i, '');
  const at = rest.indexOf('__');
  return (at >= 0 ? rest.slice(at + 2) : rest)
    .split(/[^A-Za-z0-9]+/)
    .flatMap((w) =>
      w.split(/(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])|(?<=[A-Za-z])(?=[0-9])/),
    )
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** 입력의 모든 문자열 값(중첩 포함). 상한을 넘으면 null */
function mcpStrings(value: unknown): string[] | null {
  const out: string[] = [];
  let chars = 0;
  const walk = (x: unknown, depth: number): boolean => {
    if (typeof x === 'string') {
      chars += x.length;
      out.push(x);
      return chars <= MCP_MAX_CHARS;
    }
    if (typeof x !== 'object' || x === null) return true;
    if (depth >= MCP_MAX_DEPTH) return false;
    return Object.values(x).every((child) => walk(child, depth + 1));
  };
  return walk(value, 0) ? out : null;
}

/** 글에 든 호스트 이름 가운데 금지 호스트. URL 형식이 아니어도(`github.com/o/r`, `https:\/\/…`, %인코딩) 찾는다 */
function deniedHost(text: string, hosts: string[]): string | null {
  const forms = [text];
  try {
    const decoded = decodeURIComponent(text);
    if (decoded !== text) forms.push(decoded);
  } catch {
    // 깨진 % 표기는 원문만 본다
  }
  for (const form of forms) {
    // 호스트 이름에 쓰이는 글자의 덩어리로 나눈다(정규식 되짚기 없이 길이에 비례)
    for (const token of form.toLowerCase().split(/[^a-z0-9.-]+/)) {
      const host = token.replace(/^[.-]+|[.-]+$/g, '');
      if (host.includes('.') && globAny(host, hosts)) return host;
    }
  }
  return null;
}

/**
 * MCP 도구 호출 판정. 막는 것은 삭제 계열·외부 발송(R14)과 브라우저 도구의 GitHub 접근(R20)뿐이다(제작자 결정 2026-11-16).
 * 브라우저 안의 클릭으로 닿는 경로와 이름이 규칙에 걸리지 않는 도구는 보지 못한다(13.2절, E5).
 */
export function evaluateMcp(input: GuardInput, ctx: GuardContext): Problem | null {
  const tool = input.tool ?? '';
  const cfg = ctx.mcp ? ctx.mcp() : DEFAULT_MCP_GUARD;
  const args = input.input;
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return v(
      'R14 MCP 도구',
      `MCP 도구 호출을 해석하지 못했다(입력이 객체가 아니다): ${tool}`,
      '도구 입력을 JSON 객체로 넘겨 다시 호출하라. 판단하지 못한 호출은 막는다',
      `${D} 13.1절`,
    );
  }
  if (!globAny(tool, cfg.allowTools)) {
    if (globAny(tool, cfg.denyTools)) {
      return v(
        'R14 외부 발송',
        `MCP 도구로 외부에 발송하려 했다: ${tool}`,
        '초안까지만 만들어라(예: Gmail create_draft). 발송은 제작자가 직접 한다',
        `${D} R14, 13.1절`,
      );
    }
    const deny = new Set(cfg.denyWords.map((w) => w.toLowerCase()));
    const word = mcpWords(tool).find((w) => deny.has(w));
    if (word) {
      return v(
        'R14 데이터 삭제',
        `MCP 도구로 데이터를 삭제하려 했다: ${tool} (도구 이름의 "${word}")`,
        '삭제·휴지통 이동·취소는 제작자가 직접 한다. 삭제가 아닌 도구가 이름 때문에 막혔으면 제작자에게 guard.mcp.allowTools에 더해 달라고 요청하라',
        `${D} R14, 13.1절`,
      );
    }
  }
  // allowTools는 위 두 규칙의 예외일 뿐이다: 브라우저의 GitHub 접근은 풀지 않는다
  if (globAny(tool, cfg.browserTools)) {
    const strings = mcpStrings(args);
    if (!strings) {
      return v(
        'R20 제작자 권한',
        `브라우저 자동화 도구의 입력이 너무 크거나 깊어 금지 주소가 있는지 확인하지 못했다: ${tool}`,
        '입력을 나눠 다시 호출하라. 판단하지 못한 호출은 막는다',
        `${D} R20, 13.1절`,
      );
    }
    for (const s of strings) {
      const host = deniedHost(s, cfg.denyHosts);
      if (host) {
        return v(
          'R20 제작자 권한',
          `브라우저 자동화 도구로 ${host}에 접근하려 했다: ${tool}`,
          'GitHub 작업은 봇 토큰의 gh 명령으로 한다(gh pr view, gh api …). 브라우저로 GitHub을 열지 않는다',
          `${D} R20, E5, 13.1절`,
        );
      }
    }
  }
  return null;
}

export function evaluate(input: GuardInput, ctx: GuardContext): Problem | null {
  if (input.kind === 'mcp') return evaluateMcp(input, ctx);
  if (input.kind === 'bash' && input.command) {
    for (const d of input.dialects ?? ['posix']) {
      const r = evaluateBash(input.command, input.cwd, ctx, d);
      if (r) return r;
    }
    return null;
  }
  if ((input.kind === 'read' || input.kind === 'write') && input.files) {
    for (const f of input.files) {
      const r = evaluateFile(input.kind, f, input.cwd, ctx);
      if (r) return r;
    }
  }
  return null;
}
