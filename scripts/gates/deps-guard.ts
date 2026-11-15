// deps-guard (R17, Q14). lockfile의 모든 변경(새 의존성, 버전 업, 전이 의존성)을 검사한다.
// 새로 생긴 name@version마다 레지스트리 실존, 게시 후 경과 기간, 라이선스 허용 목록, 알려진 취약점(OSV).
// 새 직접 의존성은 같은 PR의 ADR이 이름을 언급해야 한다. 조회 실패는 error(fail-closed).
// 판정 job은 비밀 없이 레지스트리·OSV에만 접속한다. 설정(cfg)은 main 쪽이다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { showFile } from '../lib/git.ts';
import { parsePnpmLock, splitSpec } from '../lib/lockfile.ts';
import { changedFiles } from './risk-gate.ts';

const DOC = 'docs/harness/design.md R17, 18절 Q14';

export interface Registry {
  /** 패키지 전체 메타데이터(`time`, `versions`). 없으면 null */
  packument(name: string): Promise<unknown | null>;
  osv(queries: { name: string; version: string }[]): Promise<unknown>;
}

export interface DepsResult {
  state: 'success' | 'failure' | 'error';
  description: string;
  details: string[];
}

/** SPDX 식을 허용 목록으로 판정한다. OR는 하나, AND는 모두. `WITH 예외`는 본 라이선스로 본다 */
export function licenseAllowed(license: unknown, allowed: string[]): boolean {
  const text =
    typeof license === 'string'
      ? license
      : license &&
          typeof license === 'object' &&
          typeof (license as { type?: unknown }).type === 'string'
        ? (license as { type: string }).type
        : null;
  if (!text) return false;
  const tokens = text.match(/\(|\)|[^\s()]+/g) ?? [];
  let i = 0;
  const atom = (): boolean | null => {
    const t = tokens[i++];
    if (t === undefined) return null;
    if (t === '(') {
      const v = or();
      if (tokens[i++] !== ')') return null;
      return v;
    }
    if (t === ')' || t === 'AND' || t === 'OR' || t === 'WITH') return null;
    if (tokens[i] === 'WITH') i += 2;
    return allowed.includes(t);
  };
  const and = (): boolean | null => {
    let v = atom();
    while (v !== null && tokens[i] === 'AND') {
      i++;
      const r = atom();
      v = r === null ? null : v && r;
    }
    return v;
  };
  function or(): boolean | null {
    let v = and();
    while (v !== null && tokens[i] === 'OR') {
      i++;
      const r = and();
      v = r === null ? null : v || r;
    }
    return v;
  }
  const v = or();
  // 식으로 읽히지 않으면(예: "SEE LICENSE IN …") 허용하지 않는다
  return v === true && i === tokens.length;
}

export async function depsGuard(o: {
  root: string;
  base: string;
  cfg: HarnessConfig;
  registry: Registry;
  now: Date;
}): Promise<DepsResult> {
  const d = o.cfg.deps;
  const changed = changedFiles(o.root, o.base).map((f) => f.path);
  const locks = d.lockfiles.filter((f) => changed.includes(f));
  if (!locks.length) return { state: 'success', description: 'lockfile 변경 없음', details: [] };

  const added = new Set<string>();
  const newDirect = new Set<string>();
  for (const f of locks) {
    const p = path.join(o.root, f);
    if (!existsSync(p)) continue; // lockfile 삭제: 새 패키지 없음
    const head = parsePnpmLock(readFileSync(p, 'utf8'));
    const base = parsePnpmLock(showFile(o.root, o.base, f) ?? '');
    for (const k of head.packages) if (!base.packages.has(k)) added.add(k);
    for (const [imp, names] of head.direct)
      for (const n of names) if (!base.direct.get(imp)?.has(n)) newDirect.add(n);
  }

  const problems: string[] = [];
  try {
    const specs = [...added].sort().map(splitSpec);
    const docs = new Map<string, unknown>();
    for (const name of new Set(specs.map((s) => s.name)))
      docs.set(name, await o.registry.packument(name));
    const live: typeof specs = [];
    for (const s of specs) {
      const id = `${s.name}@${s.version}`;
      const doc = docs.get(s.name) as {
        time?: Record<string, unknown>;
        versions?: Record<string, { license?: unknown; licenses?: unknown } | undefined>;
      } | null;
      const v = doc?.versions?.[s.version];
      if (!doc || !v) {
        problems.push(`${id}: 레지스트리에 없다`);
        continue;
      }
      live.push(s);
      const at = Date.parse(String(doc.time?.[s.version] ?? ''));
      if (Number.isNaN(at)) problems.push(`${id}: 게시 시각을 알 수 없다`);
      else {
        const days = Math.floor((o.now.getTime() - at) / 86400_000);
        if (days < d.minReleaseAgeDays)
          problems.push(`${id}: 게시 후 ${days}일(최소 ${d.minReleaseAgeDays}일)`);
      }
      const lic = v.license ?? (Array.isArray(v.licenses) ? v.licenses[0] : undefined);
      if (!licenseAllowed(lic, d.licenses))
        problems.push(
          `${id}: 라이선스 ${JSON.stringify(lic) ?? '없음'}가 허용 목록(${d.licenses.join(', ')}) 밖이다`,
        );
    }
    if (live.length) {
      const res = (await o.registry.osv(live)) as { results?: { vulns?: { id?: unknown }[] }[] };
      if (!Array.isArray(res?.results) || res.results.length !== live.length)
        throw new Error('OSV 응답 형식이 다르다');
      res.results.forEach((r, i) => {
        const ids = (r?.vulns ?? []).map((x) => String(x.id));
        if (ids.length)
          problems.push(`${live[i].name}@${live[i].version}: 알려진 취약점 ${ids.join(', ')}`);
      });
    }
  } catch (e) {
    return {
      state: 'error',
      description: `의존성 조회 실패: ${(e as Error).message.split('\n')[0].slice(0, 100)}`,
      details: [String(e)],
    };
  }

  if (newDirect.size) {
    const adrs = changed
      .filter((f) => /^docs\/decisions\/ADR-[^/]+\.md$/.test(f))
      .map((f) => path.join(o.root, f))
      .filter((p) => existsSync(p))
      .map((p) => readFileSync(p, 'utf8'));
    for (const n of [...newDirect].sort())
      if (!adrs.some((t) => t.includes(n)))
        problems.push(
          `${n}: 새 직접 의존성인데 이 PR의 ADR(docs/decisions/ADR-*.md)이 언급하지 않는다`,
        );
  }

  if (!problems.length)
    return {
      state: 'success',
      description: `lockfile 변경: 새 패키지 버전 ${added.size}개 통과`,
      details: [...added].sort(),
    };
  const more = problems.length > 1 ? ` 외 ${problems.length - 1}건` : '';
  return {
    state: 'failure',
    description: problems[0] + more,
    details: [
      ...problems,
      `고치는 법: 기준을 지키는 버전으로 바꾸거나, 새 직접 의존성이면 ADR을 함께 올려라. 기준 변경은 제작자 결정이다`,
      `근거: ${DOC}`,
    ],
  };
}

/** 실제 레지스트리·OSV. 테스트에서는 쓰지 않는다 */
export function httpRegistry(d: HarnessConfig['deps']): Registry {
  const get = async (url: string, init?: RequestInit) =>
    fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  return {
    async packument(name) {
      const res = await get(`${d.registry.replace(/\/$/, '')}/${name.replace('/', '%2F')}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`레지스트리 HTTP ${res.status}: ${name}`);
      return res.json();
    },
    async osv(queries) {
      const res = await get(d.osvApi, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          queries: queries.map((q) => ({
            package: { name: q.name, ecosystem: 'npm' },
            version: q.version,
          })),
        }),
      });
      if (!res.ok) throw new Error(`OSV HTTP ${res.status}`);
      return res.json();
    },
  };
}
