// Codex 판정 job의 인증 도구(13.3절, 10.4절 "Codex 샌드박스"). LLM 없이 base/에서만 실행한다.
// 인증 값은 돌려주지도 출력하지도 않는다. 필드 이름과 sha256 앞 8자(공백을 뺀 한 줄 JSON 기준)만 다룬다.
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

export const JUDGE_PROFILE = 'judge';

type Auth = Record<string, unknown>;

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const canonical = (obj: Auth) => JSON.stringify(obj);
const sha8 = (obj: Auth) => sha(canonical(obj)).slice(0, 8);

/** 잎 필드 경로와 값. tokens 같은 객체는 한 단계 펼친다 */
function leaves(obj: Auth): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v))
      for (const [k2, v2] of Object.entries(v)) out.push([`${k}.${k2}`, v2]);
    else out.push([k, v]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

/** 오류에는 위치만 적는다(값을 넣지 않는다) */
function parseAuth(text: string, where: string): Auth {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error(`${where}: JSON이 아니다`);
  }
  const o = obj as Auth | null;
  if (!o || typeof o !== 'object' || !o.tokens || typeof o.tokens !== 'object')
    throw new Error(`${where}: tokens가 없다(ChatGPT 로그인 auth.json이 아니다)`);
  return o;
}
const readAuth = (f: string) => parseAuth(readFileSync(f, 'utf8'), path.basename(f));

const fieldHashes = (obj: Auth): Record<string, string> =>
  Object.fromEntries(leaves(obj).map(([k, v]) => [k, sha(JSON.stringify(v)).slice(0, 8)]));

export interface AuthSnapshot {
  sha8: string;
  fields: Record<string, string>;
}

/** 시크릿 값 → <home>/auth.json(0600). 폴더는 0700 */
export function restoreAuth(
  raw: string,
  home: string,
): { sha8: string; fields: string[]; apiKey: boolean } {
  const obj = parseAuth(raw, 'CODEX_AUTH_JSON');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const f = path.join(home, 'auth.json');
  writeFileSync(f, canonical(obj), { mode: 0o600 });
  chmodSync(f, 0o600);
  return {
    sha8: sha8(obj),
    fields: leaves(obj).map(([k]) => k),
    apiKey: typeof obj.OPENAI_API_KEY === 'string' && obj.OPENAI_API_KEY.length > 0,
  };
}

export function snapshotAuth(file: string): AuthSnapshot {
  const obj = readAuth(file);
  return { sha8: sha8(obj), fields: fieldHashes(obj) };
}

/** 실행 전 스냅숏과 지금 파일을 비교해 바뀐 필드 이름만 낸다 */
export function diffAuth(
  before: AuthSnapshot,
  file: string,
): { sha8: string; changed: boolean; fieldsChanged: string[] } {
  const obj = readAuth(file);
  const now = fieldHashes(obj);
  const names = [...new Set([...Object.keys(before.fields), ...Object.keys(now)])].sort();
  const s = sha8(obj);
  return {
    sha8: s,
    changed: s !== before.sha8,
    fieldsChanged: names.filter((k) => before.fields[k] !== now[k]),
  };
}

/** a가 b와 같거나 b의 조상인가 */
function covers(a: string, b: string): boolean {
  const rel = path.relative(path.resolve(a), path.resolve(b));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const q = (s: string) => JSON.stringify(s); // TOML 기본 문자열(경로에 쓰는 문자는 JSON과 같다)

const FEATURES_OFF = [
  'apps',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'hooks',
  'image_generation',
  'in_app_browser',
  'memories',
  'multi_agent',
  'plugins',
  'remote_plugin',
  // 셸 환경 스냅숏(내보낸 변수 포함)을 CODEX_HOME에 두고 명령마다 읽는다
  'shell_snapshot',
  'skill_mcp_dependency_install',
  'skill_search',
  'tool_suggest',
  'view_image',
];

/**
 * 판정용 config.toml. 내장 read-only 샌드박스는 파일 시스템 전체를 읽으므로 쓰지 않고,
 * 권한 프로필에 읽기 거부 목록을 준다. PR 트리의 설정·지침·훅·스킬은 적용하지 않는다(10.4절).
 */
export function writeCodexConfig(o: { home: string; prDir: string; denyDirs: string[] }): void {
  if (!o.denyDirs.length) throw new Error('거부 폴더가 없다');
  // 거부 폴더가 pr/의 조상이거나 pr/ 자신이면 Linux에서 pr/ 읽기까지 막힌다(Q20). pr/ 하위는 된다
  for (const d of o.denyDirs)
    if (covers(d, o.prDir)) throw new Error(`거부 폴더가 pr/의 조상이거나 pr/ 자신이다: ${d}`);
  if (!o.denyDirs.some((d) => covers(d, o.home)))
    throw new Error('인증 폴더(CODEX_HOME)가 거부 목록에 들어 있지 않다');
  const lines = [
    '# base 스크립트(scripts/ci/codex-auth.ts)가 만든 판정 설정. 손으로 고치지 않는다',
    'approval_policy = "never"',
    `default_permissions = "${JUDGE_PROFILE}"`,
    'web_search = "disabled"',
    'cli_auth_credentials_store = "file"',
    'project_doc_max_bytes = 0',
    '',
    '[features]',
    ...FEATURES_OFF.map((f) => `${f} = false`),
    '',
    '[skills.bundled]',
    'enabled = false',
    '',
    '[shell_environment_policy]',
    'inherit = "core"',
    // KEY·SECRET·TOKEN이 든 변수를 빼는 기본 필터를 켠다
    'ignore_default_excludes = false',
    '',
    `[permissions.${JUDGE_PROFILE}.filesystem]`,
    '":minimal" = "read"',
    `${q(o.prDir)} = "read"`,
    ...o.denyDirs.map((d) => `${q(d)} = "deny"`),
    '',
    `[projects.${q(o.prDir)}]`,
    'trust_level = "untrusted"',
    '',
  ];
  writeFileSync(path.join(o.home, 'config.toml'), lines.join('\n'));
}

interface Sodium {
  ready: Promise<void>;
  base64_variants: { ORIGINAL: number };
  crypto_box_seal(message: Uint8Array, publicKey: Uint8Array): Uint8Array;
  from_base64(s: string, variant: number): Uint8Array;
  to_base64(b: Uint8Array, variant: number): string;
}

/**
 * auth.json을 environment의 GitHub 공개키로 봉인한다(libsodium sealed box, 시크릿 API 형식).
 * 풀 수 있는 것은 GitHub뿐이다. libsodium은 리포 의존성이 아니라 판정 job이 따로 설치한 폴더에서 읽는다.
 */
export async function sealAuth(file: string, pubkey: string, sodiumDir: string): Promise<string> {
  if (!/^[A-Za-z0-9+/]+=*$/.test(pubkey) || Buffer.from(pubkey, 'base64').length !== 32)
    throw new Error('공개키는 base64 32바이트여야 한다');
  if (!sodiumDir) throw new Error('libsodium 모듈 폴더가 없다');
  const plain = canonical(readAuth(file));
  const dir = path.resolve(sodiumDir);
  let sodium: Sodium;
  try {
    if (!existsSync(dir)) throw new Error('없는 폴더');
    sodium = createRequire(path.join(dir, 'noop.js'))('libsodium-wrappers') as Sodium;
  } catch {
    throw new Error(`libsodium-wrappers를 읽지 못했다: ${dir}`);
  }
  await sodium.ready;
  const v = sodium.base64_variants.ORIGINAL;
  const sealed = sodium.crypto_box_seal(Buffer.from(plain, 'utf8'), sodium.from_base64(pubkey, v));
  return sodium.to_base64(sealed, v);
}
