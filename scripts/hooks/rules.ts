// L1 금지 규칙(5절 R1~R4, R10, R13, R14, R20). guard.ts가 도구 실행 직전에 호출한다.
// 반환값이 있으면 차단한다. 메시지는 "무엇이 틀렸나 + 고치는 법 + 근거"(5.1절).
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import type { RepoInfo } from '../lib/git.ts';
import { PLANS_DIR, parseBranch } from '../lib/plan.ts';
import type { Problem } from '../lib/util.ts';
import { baseName, parseShell, type SimpleCommand } from './shell.ts';

export type ToolKind = 'bash' | 'read' | 'write' | 'other';

export interface GuardInput {
  kind: ToolKind;
  command?: string;
  /** read/write 대상 파일들 */
  files?: string[];
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

function tmpRoots(ctx: GuardContext): string[] {
  return ctx.tmpDirs ?? [tmpdir(), '/tmp', '/private/tmp', '/var/folders', '/private/var/folders'];
}

function expandHome(p: string, home: string): string {
  if (p === '~') return home;
  if (p.startsWith('~/')) return path.join(home, p.slice(2));
  return p.replace(/^\$HOME(?=\/|$)/, home).replace(/^\$\{HOME\}(?=\/|$)/, home);
}

function isEnvFile(p: string): boolean {
  const b = baseName(p.split('=').pop() ?? p);
  return /^\.env(\..+)?$/.test(b) && !/^\.env\.(example|sample|template)$/.test(b);
}

const CREDENTIAL_FILES =
  /(^|\/)(\.config\/gh\/hosts\.yml|\.git-credentials|\.netrc|\.aws\/credentials|\.codex\/auth\.json|\.claude\/\.credentials\.json|\.npmrc-auth|Library\/Keychains\/[^/]+)$/;

function isCredentialFile(p: string, home: string): boolean {
  return CREDENTIAL_FILES.test(expandHome(p, home).replace(/\\/g, '/'));
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

function ghRules(c: SimpleCommand): Problem | null {
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
  const hit = c.argv.find((x) => clients.has(baseName(x)));
  if (hit) {
    return v(
      'R13 DB 위험 작업',
      `DB 클라이언트(${baseName(hit)})로 직접 접속하려 했다`,
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

function rmRule(c: SimpleCommand, cwd: string, ctx: GuardContext): Problem | null {
  if (baseName(c.argv[0]) !== 'rm') return null;
  const args = c.argv.slice(1);
  const dd = args.indexOf('--');
  const flags = (dd >= 0 ? args.slice(0, dd) : args).filter((a) => a.startsWith('-'));
  const recursive = flags.some((f) => f === '--recursive' || /^-[a-zA-Z]*[rR]/.test(f));
  if (!recursive) return null;
  const targets =
    dd >= 0
      ? [...args.slice(0, dd).filter((a) => !a.startsWith('-')), ...args.slice(dd + 1)]
      : args.filter((a) => !a.startsWith('-'));
  const home = ctx.home ?? homedir();
  const root = ctx.repo?.root ?? null;
  const bad = (what: string) =>
    v(
      'R14 파괴적 명령',
      what,
      '지울 대상을 worktree 안의 구체적인 경로로 지정하라. 리포 정리는 표준 명령이 한다',
      `${D} R14, 14.4절`,
    );
  for (const t of targets) {
    if (/\$|`|…/.test(t.replace(/^\$HOME|^\$\{HOME\}/, '')))
      return bad(`재귀 삭제 대상에 해석할 수 없는 변수가 있다: ${t}`);
    const abs = path.resolve(cwd, expandHome(t, home));
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
  const head = baseName(a[0]);
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

function secretRules(c: SimpleCommand, ctx: GuardContext): Problem | null {
  const home = ctx.home ?? homedir();
  const tokenChange =
    Object.keys(c.assigns).find((k) => TOKEN_VARS.includes(k)) ??
    c.unsets.find((k) => TOKEN_VARS.includes(k));
  if (tokenChange) {
    return v(
      'R20 제작자 권한',
      `${tokenChange}를 바꾸거나 해제하려 했다`,
      '에이전트 세션은 시작할 때 받은 봇 토큰만 쓴다',
      `${D} R20, E5`,
    );
  }
  if (!c.argv.length) return null;
  const head = baseName(c.argv[0]);
  if (head === 'security' && /^(find-|dump-|export|unlock-keychain)/.test(c.argv[1] ?? '')) {
    return v(
      'R20 제작자 권한',
      `macOS 키체인을 조회하려 했다(security ${c.argv[1]})`,
      '에이전트는 키체인에 접근하지 않는다',
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

// ---------- 진입점 ----------

export function evaluateBash(command: string, cwd: string, ctx: GuardContext): Problem | null {
  for (const c of parseShell(command)) {
    const r =
      secretRules(c, ctx) ??
      (c.argv.length && baseName(c.argv[0]) === 'git' ? gitRules(c, cwd, ctx) : null) ??
      (c.argv.length && baseName(c.argv[0]) === 'gh' ? ghRules(c) : null) ??
      (c.argv.length ? dbRules(c, ctx) : null) ??
      (c.argv.length ? rmRule(c, cwd, ctx) : null) ??
      (c.argv.length ? externalRules(c) : null);
    if (r) return r;
  }
  return null;
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
  const repo = ctx.repo;
  if (!repo) return null;
  if (!within(abs, repo.root)) {
    // 리포 밖이라도 임시 폴더와 Claude 계획 파일은 허용한다
    if (tmpRoots(ctx).some((d) => within(abs, d))) return null;
    if (within(abs, path.join(home, '.claude', 'plans'))) return null;
    return v(
      'R3 worktree',
      `worktree 밖의 파일을 수정하려 했다: ${abs}`,
      '현재 worktree 안의 파일만 고쳐라. 다른 작업은 다른 worktree에서 한다',
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

export function evaluate(input: GuardInput, ctx: GuardContext): Problem | null {
  if (input.kind === 'bash' && input.command) return evaluateBash(input.command, input.cwd, ctx);
  if ((input.kind === 'read' || input.kind === 'write') && input.files) {
    for (const f of input.files) {
      const r = evaluateFile(input.kind, f, input.cwd, ctx);
      if (r) return r;
    }
  }
  return null;
}
