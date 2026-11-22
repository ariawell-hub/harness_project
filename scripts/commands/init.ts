// init (16절 새 프로젝트 3): 프로파일 선택, 표준 명령 연결, 템플릿 복사, 남은 수동 작업 안내.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { CONFIG_FILE } from '../lib/config.ts';
import { log } from '../lib/util.ts';

interface ProfileFile {
  name: string;
  version: string;
  description?: string;
  /** harness.config.json에 그대로 덮어쓸 항목 */
  config: Record<string, unknown>;
  templates?: { from: string; to: string; replacePlaceholder?: boolean }[];
}

type RequiredCheck = { context: string; source: 'actions' | 'recorder' };

/** 제작자가 등록할 필수 체크 목록(0.2절). 설정(ci.requiredChecks)에서 만들어 목록이 설정과 어긋나지 않게 한다 */
export function requiredCheckGuide(checks: readonly RequiredCheck[]): string {
  const of = (s: RequiredCheck['source']) =>
    checks.filter((c) => c.source === s).map((c) => c.context);
  const actions = of('actions');
  const recorder = of('recorder');
  if (!actions.length && !recorder.length)
    return `${CONFIG_FILE}의 ci.requiredChecks에 등록할 체크를 먼저 적는다`;
  return [
    actions.length ? `${actions.join('·')}(GitHub Actions)` : '',
    recorder.length
      ? `${recorder.join('·')}(출처 = 검증 App. review/*와 review-ledger는 판정 워크플로가 실제 PR에서 판정을 낸 뒤 등록)`
      : '',
  ]
    .filter(Boolean)
    .join(', ');
}

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 값이 달라진 설정 항목의 이름. 양쪽 값이 모두 객체면 그 아래 키까지 적는다(`github.owner`).
 * 키의 순서만 다른 것은 달라진 것으로 보지 않는다
 */
export function changedKeys(before: Json, after: Json): string[] {
  const out: string[] = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const b = before[k];
    const a = after[k];
    if (isDeepStrictEqual(b, a)) continue;
    if (!isObject(b) || !isObject(a)) {
      out.push(k);
      continue;
    }
    for (const s of new Set([...Object.keys(b), ...Object.keys(a)]))
      if (!isDeepStrictEqual(b[s], a[s])) out.push(`${k}.${s}`);
  }
  return out;
}

/**
 * 경로의 실제 위치가 대상 폴더(실제 경로) 안인가. 심볼릭 링크를 따라간 위치로 본다.
 * 아직 없는 경로는 있는 가장 가까운 상위 폴더의 실제 위치에 나머지를 붙여 본다. 끊긴 링크는 밖으로 본다
 * (그 자리에 쓰면 링크가 가리키는 곳에 파일이 생긴다)
 */
export function resolvesInside(realRoot: string, p: string): boolean {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      lstatSync(cur);
      break;
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return false;
      rest.unshift(path.basename(cur));
      cur = up;
    }
  }
  let real: string;
  try {
    real = realpathSync(cur);
  } catch {
    return false;
  }
  const full = path.join(real, ...rest);
  return full === realRoot || full.startsWith(realRoot + path.sep);
}

/**
 * 경로가 가리키는 파일의 정체. 있는 파일은 장치와 아이노드 번호라, 이름이 달라도 같은 파일이면 같다
 * (심볼릭 링크, 하드 링크, 대소문자를 가리지 않는 파일 시스템). 아직 없는 파일은 있는 가장 가까운
 * 상위 폴더의 정체에 나머지 경로를 붙인다
 */
export function fileKey(p: string): string {
  let cur = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      const st = statSync(cur, { bigint: true });
      return [`${st.dev}:${st.ino}`, ...rest].join('/');
    } catch {
      const up = path.dirname(cur);
      if (up === cur) return [cur, ...rest].join('/');
      rest.unshift(path.basename(cur));
      cur = up;
    }
  }
}

const PLACEHOLDER = 'harness:placeholder';

export interface InitOptions {
  owner?: string;
  bot?: string;
  /** 파일을 쓰지 않고 바뀔 것과 남은 수동 작업만 출력한다 */
  dryRun?: boolean;
}

export function init(root: string, profile: string, opts: InitOptions): number {
  const cfgPath = path.join(root, CONFIG_FILE);
  if (!existsSync(cfgPath)) {
    process.stderr.write(
      `설정 파일이 없다: ${cfgPath}\n하네스 템플릿을 복사한 폴더에서 실행하거나 --repo로 그 폴더를 가리켜라\n`,
    );
    return 1;
  }
  const pf = path.join(root, 'profiles', profile, 'profile.json');
  if (!existsSync(pf)) {
    process.stderr.write(
      `프로파일이 없다: ${pf}\n사용 가능: profiles/ 아래 폴더 이름(core, web)\n`,
    );
    return 1;
  }
  // 읽고 쓰는 경로가 모두 대상 폴더 안인지 먼저 본다. 하나라도 밖이면 아무것도 쓰지 않는다:
  // 대상 폴더의 파일이 밖을 가리키는 심볼릭 링크면 그 자리에 쓸 때 밖의 파일이 바뀐다
  const realRoot = realpathSync(root);
  const stop = (why: string, files: string[]): number => {
    process.stderr.write(`${why}: ${files.join(', ')}\n아무것도 쓰지 않았다. 대상: ${realRoot}\n`);
    return 1;
  };
  const refuse = (files: string[]) =>
    stop('대상 폴더 밖을 가리키는 경로가 있다(심볼릭 링크나 상위 경로)', files);
  const outsideRoot = (files: string[]) => files.filter((f) => !resolvesInside(realRoot, f));
  const base = outsideRoot([cfgPath, pf]);
  if (base.length) return refuse(base);
  const p = JSON.parse(readFileSync(pf, 'utf8')) as ProfileFile;
  const tpl = outsideRoot(
    (p.templates ?? []).flatMap((t) => [
      path.join(root, 'profiles', profile, t.from),
      path.join(root, t.to),
    ]),
  );
  if (tpl.length) return refuse(tpl);
  const before = JSON.parse(readFileSync(cfgPath, 'utf8')) as Json;
  // 프로파일의 항목을 먼저 덮어쓰고, 그 결과의 github에 명령줄의 값을 적는다(프로파일이 github을 정할 수 있다)
  const merged: Json = { ...before, ...p.config };
  const gh = { ...((merged.github ?? {}) as Json) };
  if (opts.owner) gh.owner = opts.owner;
  if (opts.bot) gh.bot = opts.bot;
  const cfg: Json = {
    ...merged,
    profile: p.name,
    profileVersion: `${p.name}@${p.version}`,
    github: gh,
  };
  const dry = opts.dryRun === true;
  const name = `${p.name}@${p.version}`;
  const changed = changedKeys(before, cfg);
  // 템플릿마다 할 일을 미리 정한다(미리보기와 쓰기 전 검사에 쓴다). 파일을 쓰지 않고, 프로파일의 순서대로
  // 차례로 처리했을 때의 결과를 따라간다: after는 이번 실행이 쓸 파일의 정체 → 쓴 뒤의 내용이다.
  // 뒤의 템플릿은 앞의 것이 쓴 파일을 이미 있는 것으로 보고, 그 내용으로 자리 표시 여부와 복사할 글을 정한다.
  // 파일은 경로의 글자가 아니라 정체로 가린다(같은 파일을 가리키는 다른 경로가 있다)
  const cfgText = JSON.stringify(cfg, null, 2) + '\n';
  const after = new Map<string, Buffer>();
  if (changed.length) after.set(fileKey(cfgPath), Buffer.from(cfgText));
  const contentOf = (f: string) => after.get(fileKey(f)) ?? readFileSync(f);
  const present = (f: string) => after.has(fileKey(f)) || existsSync(f);
  const jobs: { to: string; copy: boolean; overwrite: string | null }[] = [];
  const missing: string[] = [];
  for (const t of p.templates ?? []) {
    const src = path.join(root, 'profiles', profile, t.from);
    const dst = path.join(root, t.to);
    const copy =
      !present(dst) || (t.replacePlaceholder === true && contentOf(dst).includes(PLACEHOLDER));
    if (copy && !present(src)) {
      missing.push(src);
      continue;
    }
    // 디스크에 있던 파일을 덮어쓰는 것만 하드 링크 검사의 대상이다(이번 실행이 만든 파일은 새 파일이다)
    jobs.push({ to: t.to, copy, overwrite: copy && existsSync(dst) ? dst : null });
    if (copy) after.set(fileKey(dst), contentOf(src));
  }
  if (missing.length) return stop('템플릿 원본이 없다', missing);
  // 덮어쓸 파일이 하드 링크로 다른 이름과 이어져 있으면 쓰지 않는다. 그 자리에 쓰면 다른 이름으로
  // 보이는 파일(다른 리포의 설정일 수 있다)도 함께 바뀐다. 어디와 이어졌는지는 알 수 없어 모두 거절한다
  const linked = [
    ...(changed.length ? [cfgPath] : []),
    ...jobs.flatMap((j) => (j.overwrite ? [j.overwrite] : [])),
  ].filter((f) => lstatSync(realpathSync(f)).nlink > 1);
  if (linked.length) return stop('다른 이름과 이어진 파일(하드 링크)에는 쓰지 않는다', linked);
  if (dry) {
    log(`[dry-run] 파일을 쓰지 않는다. 대상: ${root}`);
    log(
      changed.length
        ? `프로파일 ${name}을 적용하면 ${CONFIG_FILE}의 다음 항목이 바뀐다: ${changed.join(', ')}`
        : `프로파일 ${name}은 이미 적용돼 있다: ${CONFIG_FILE}에서 바뀌는 항목이 없다.`,
    );
  } else if (!changed.length) {
    log(`프로파일 ${name}은 이미 적용돼 있다: ${CONFIG_FILE}을 다시 쓰지 않았다.`);
  } else {
    writeFileSync(cfgPath, cfgText);
    log(`프로파일 ${name}을 ${CONFIG_FILE}에 적용했다. 바뀐 항목: ${changed.join(', ')}`);
    log(
      `- 파일 전체를 다시 써 서식이 달라졌을 수 있다. 의존성을 설치한 뒤 node scripts/harness.ts fmt로 맞춘다.`,
    );
  }

  if (dry) {
    for (const j of jobs)
      log(j.copy ? `- 템플릿 복사 예정: ${j.to}` : `- 건너뜀(이미 있음): ${j.to}`);
  } else {
    // 실제 적용은 전처럼 차례로, 그 순간의 파일을 보고 정한다. 위에서 미리 정한 것과 같은 결정이 나온다.
    // 미리 정할 때 가리지 못하는 것은 아직 없는 두 이름이 같은 파일이 되는 경우뿐이다(대소문자를 가리지 않는
    // 파일 시스템의 Guide.md와 guide.md). 그때도 여기서는 앞의 것이 만든 파일을 보고 건너뛴다.
    // 그 파일은 이번 실행이 만든 새 파일이라 하드 링크 검사의 대상이 아니다
    for (const t of p.templates ?? []) {
      const src = path.join(root, 'profiles', profile, t.from);
      const dst = path.join(root, t.to);
      if (existsSync(dst)) {
        const placeholder = t.replacePlaceholder && readFileSync(dst, 'utf8').includes(PLACEHOLDER);
        if (!placeholder) {
          log(`- 건너뜀(이미 있음): ${t.to}`);
          continue;
        }
      }
      mkdirSync(path.dirname(dst), { recursive: true });
      copyFileSync(src, dst);
      log(`- 템플릿 복사: ${t.to}`);
    }
  }

  const checks = (cfg.ci as { requiredChecks?: RequiredCheck[] } | undefined)?.requiredChecks ?? [];
  log(`
남은 수동 작업 (제작자가 직접, docs/harness/design.md 0절·16절):
  1. 전제 조건 E1~E5: 봇 계정 + 리포 한정 토큰(90일 이하), GitHub Pro, 이 Mac에서 제작자 gh 로그아웃(E5)
  2. 원격 리포 생성 후 main push, 0.2절 브랜치 보호(PR 필수, force push 금지, 최신 브랜치 필수, stale 승인 무효화)
  3. Actions: 기본 권한 읽기 전용, "Actions가 PR 승인" 끔, 리포 수준 시크릿 없음
  4. 검증 App과 recorder environment(main만)를 만들고, App이 한 번 보고한 뒤 필수 상태 체크를 등록: ${requiredCheckGuide(checks)}. 확인: node scripts/harness.ts required-checks
  5. ${CONFIG_FILE}의 github.owner(제작자 계정)와 github.bot(봇 계정) 확인. 제작자 계정이나 protectedPaths를 바꿨으면 node scripts/harness.ts codeowners --write
  6. 라벨 만들기: needs-human, priority:high|medium|low, size:small|medium|large, risk:low|high, bug
  7. runner 실행 환경: GH_TOKEN=<봇 토큰> node scripts/harness.ts run --worker runner-1
  8. 운영 전환 전(10.4절 체크리스트 1~3): node scripts/harness.ts ops-check`);
  return 0;
}
