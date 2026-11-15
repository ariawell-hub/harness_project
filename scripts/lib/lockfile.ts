// pnpm-lock.yaml(lockfile v9) 줄 단위 파서. deps-guard(R17)가 쓴다.
// YAML 파서를 쓰지 않는다(ADR-0001: node: 내장 모듈만). 필요한 것은 packages 키와 importers의 직접 의존성 이름뿐이다.

export interface PnpmLock {
  /** `name@version` (피어 접미사 제외) */
  packages: Set<string>;
  /** importer 경로 → 직접 의존성 이름 */
  direct: Map<string, Set<string>>;
}

const unquote = (s: string) => s.replace(/^(['"])(.*)\1$/, '$2');

/** `name@1.2.3(peer@x)` → 이름과 버전. 스코프의 앞 `@`는 이름이다 */
export function splitSpec(key: string): { name: string; version: string } {
  const k = key.replace(/\(.*$/, '');
  const at = k.lastIndexOf('@');
  return at > 0 ? { name: k.slice(0, at), version: k.slice(at + 1) } : { name: k, version: '' };
}

const DEP_GROUPS = ['dependencies', 'devDependencies', 'optionalDependencies'];

export function parsePnpmLock(text: string): PnpmLock {
  const packages = new Set<string>();
  const direct = new Map<string, Set<string>>();
  let top = '';
  let importer: string | null = null;
  let group: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const m = /^(\s*)(.+?):(\s.*)?$/.exec(raw);
    if (!m) continue;
    const key = unquote(m[2].trim());
    if (indent === 0) {
      top = key;
      importer = group = null;
    } else if (top === 'packages' && indent === 2) {
      const s = splitSpec(key);
      if (s.version) packages.add(`${s.name}@${s.version}`);
    } else if (top === 'importers') {
      if (indent === 2) {
        importer = key;
        group = null;
        direct.set(key, direct.get(key) ?? new Set());
      } else if (indent === 4) group = DEP_GROUPS.includes(key) ? key : null;
      else if (indent === 6 && importer && group) direct.get(importer)!.add(key);
    }
  }
  return { packages, direct };
}
