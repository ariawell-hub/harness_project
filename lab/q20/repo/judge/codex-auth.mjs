// Q20 judge-codex·codex-auth(계획 20261111-q20-lab step5): Codex 판정 job의 인증 도구. LLM 없이 base/에서만 실행한다.
// 인증 값은 출력하지 않는다. sha256 앞 8자(공백을 뺀 한 줄 JSON 기준)와 필드 이름만 출력한다.
//
//   CODEX_AUTH_JSON=… node codex-auth.mjs restore <codex_home>        시크릿 → <codex_home>/auth.json(0600)
//   node codex-auth.mjs age <auth.json> <days>                        last_refresh를 N일 전으로(갱신 유도)
//   node codex-auth.mjs snapshot <auth.json> <snap.json>              필드별 해시 기록(값 없음)
//   node codex-auth.mjs diff <snap.json> <auth.json>                  바뀐 필드 이름 출력
//   node codex-auth.mjs config <codex_home> <pr_dir> <deny_dir>...    판정 설정 config.toml 생성
//   Q20_SODIUM_DIR=… node codex-auth.mjs seal <auth.json> <pubkey>    GitHub 공개키로 봉인, stdout `sealed=<base64>`
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const sha = (s) => createHash('sha256').update(s).digest('hex');
const canonical = (obj) => JSON.stringify(obj);
const sha8 = (obj) => sha(canonical(obj)).slice(0, 8);

function fail(msg) {
  console.error(`Q20 codex auth error=${msg}`);
  process.exit(1);
}

/** 잎 필드 경로와 값. tokens 같은 객체는 한 단계 펼친다 */
function leaves(obj) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object' && !Array.isArray(v))
      for (const [k2, v2] of Object.entries(v)) out.push([`${k}.${k2}`, v2]);
    else out.push([k, v]);
  }
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function parseAuth(text, where) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    fail(`${where}: JSON이 아니다`);
  }
  if (!obj || typeof obj !== 'object' || !obj.tokens || typeof obj.tokens !== 'object')
    fail(`${where}: tokens가 없다(ChatGPT 로그인 auth.json이 아니다)`);
  return obj;
}
const readAuth = (f) => parseAuth(readFileSync(f, 'utf8'), path.basename(f));

function fieldHashes(obj) {
  return Object.fromEntries(leaves(obj).map(([k, v]) => [k, sha(JSON.stringify(v)).slice(0, 8)]));
}

function restore(home) {
  const obj = parseAuth(process.env.CODEX_AUTH_JSON ?? '', 'CODEX_AUTH_JSON');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const f = path.join(home, 'auth.json');
  writeFileSync(f, canonical(obj), { mode: 0o600 });
  chmodSync(f, 0o600);
  const fields = leaves(obj).map(([k]) => k);
  const apiKey = typeof obj.OPENAI_API_KEY === 'string' && obj.OPENAI_API_KEY.length > 0;
  console.log(
    `Q20 codex auth restore sha8=${sha8(obj)} fields=${fields.join(',')} api_key=${apiKey}`,
  );
}

function age(f, days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) fail('days는 양수여야 한다');
  const obj = readAuth(f);
  if (!('last_refresh' in obj)) fail('last_refresh 필드가 없다');
  obj.last_refresh = new Date(Date.now() - n * 86400e3).toISOString();
  writeFileSync(f, canonical(obj), { mode: 0o600 });
  console.log(`Q20 codex auth age days=${n} sha8=${sha8(obj)}`);
}

function snapshot(f, snap) {
  const obj = readAuth(f);
  writeFileSync(snap, JSON.stringify({ sha8: sha8(obj), fields: fieldHashes(obj) }));
}

function diff(snap, f) {
  const before = JSON.parse(readFileSync(snap, 'utf8'));
  const obj = readAuth(f);
  const now = fieldHashes(obj);
  const names = [...new Set([...Object.keys(before.fields), ...Object.keys(now)])].sort();
  const changed = names.filter((k) => before.fields[k] !== now[k]);
  const s = sha8(obj);
  console.log(
    `Q20 codex auth after sha8=${s} changed=${s !== before.sha8} fields_changed=${changed.join(',') || '-'}`,
  );
}

const q = (s) => JSON.stringify(s); // TOML 기본 문자열(경로에 쓰는 문자는 JSON과 같다)

function config(home, prDir, denyDirs) {
  const lines = [
    '# Q20 judge-codex: base 스크립트가 만든 판정 설정(LLM 없음). 계획 20261111-q20-lab step5 의사결정 로그',
    'approval_policy = "never"',
    'default_permissions = "q20judge"',
    'web_search = "disabled"',
    'cli_auth_credentials_store = "file"',
    'project_doc_max_bytes = 0',
    '',
    '[features]',
    ...[
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
    ].map((f) => `${f} = false`),
    '',
    '[skills.bundled]',
    'enabled = false',
    '',
    '[shell_environment_policy]',
    'inherit = "core"',
    // KEY·SECRET·TOKEN이 든 변수를 빼는 기본 필터를 켠다(문서의 기본값 설명이 모호해 명시한다)
    'ignore_default_excludes = false',
    '',
    '[permissions.q20judge.filesystem]',
    '":minimal" = "read"',
    `${q(prDir)} = "read"`,
    ...denyDirs.map((d) => `${q(d)} = "deny"`),
    '',
    `[projects.${q(prDir)}]`,
    'trust_level = "untrusted"',
    '',
  ];
  writeFileSync(path.join(home, 'config.toml'), lines.join('\n'));
  console.log(`Q20 codex config pr=${prDir} deny=${denyDirs.join(',')}`);
}

async function seal(f, pubkey) {
  const key = Buffer.from(pubkey ?? '', 'base64');
  if (key.length !== 32) fail('공개키는 base64 32바이트여야 한다');
  const plain = canonical(readAuth(f));
  const dir = process.env.Q20_SODIUM_DIR;
  if (!dir) fail('Q20_SODIUM_DIR가 없다');
  const sodium = createRequire(path.join(path.resolve(dir), 'noop.js'))('libsodium-wrappers');
  await sodium.ready;
  const v = sodium.base64_variants.ORIGINAL;
  const sealed = sodium.crypto_box_seal(Buffer.from(plain, 'utf8'), sodium.from_base64(pubkey, v));
  process.stdout.write(`sealed=${sodium.to_base64(sealed, v)}\n`);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'restore':
    restore(args[0]);
    break;
  case 'age':
    age(args[0], args[1]);
    break;
  case 'snapshot':
    snapshot(args[0], args[1]);
    break;
  case 'diff':
    diff(args[0], args[1]);
    break;
  case 'config':
    config(args[0], args[1], args.slice(2));
    break;
  case 'seal':
    await seal(args[0], args[1]);
    break;
  default:
    fail('사용법: restore|age|snapshot|diff|config|seal');
}
