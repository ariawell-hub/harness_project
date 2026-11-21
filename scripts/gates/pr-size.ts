// pr-size (R15, 10.2절 (1)): PR의 변경 줄 수가 상한을 넘으면 경고한다. 병합을 막지 않는다.
// 생성 파일·테스트·문서는 세지 않는다. 설정(cfg)은 main 쪽이다. git은 root에서 읽기만 한다.
import type { HarnessConfig } from '../lib/config.ts';
import { git } from '../lib/git.ts';
import { capDetails, globToRegExp, showPath, WARN_PREFIX } from '../lib/util.ts';

const DOC = 'docs/harness/design.md 10.2절 (1), R15';
/** details에 적는 파일 수 상한 */
const FILE_LIMIT = 30;

export interface SizedFile {
  path: string;
  /** 추가 + 삭제 줄 수. 바이너리는 0 */
  lines: number;
  binary: boolean;
}

/** merge-base 대비 바뀐 파일과 줄 수(삭제 포함, 이름 바꾸기는 삭제와 추가로 센다) */
export function changedLines(root: string, base: string): SizedFile[] {
  const out = git(['diff', '--numstat', '-z', '--no-renames', `${base}...HEAD`], root);
  const files: SizedFile[] = [];
  for (const rec of out.split('\0')) {
    if (rec === '') continue;
    const m = /^(-|\d+)\t(-|\d+)\t([\s\S]+)$/.exec(rec);
    if (!m) throw new Error('git diff --numstat 출력을 해석하지 못했다');
    const binary = m[1] === '-' || m[2] === '-';
    files.push({ path: m[3], lines: binary ? 0 : Number(m[1]) + Number(m[2]), binary });
  }
  return files;
}

export interface PrSizeResult {
  state: 'success';
  description: string;
  details: string[];
  /** 센 줄 수(제외한 파일을 뺀 합) */
  lines: number;
  over: boolean;
}

/** 바뀐 파일 목록으로 판정한다(순수 함수). 경로는 git이 준 글자 그대로 glob과 견준다(`\`를 `/`로 바꾸지 않고, 줄바꿈이 든 경로도 맞는다) */
export function prSizeOf(
  files: SizedFile[],
  cfg: Pick<HarnessConfig, 'prSize' | 'deps'>,
): PrSizeResult {
  const { maxLines, exclude } = cfg.prSize;
  const skip = [...exclude, ...cfg.deps.lockfiles].map(globToRegExp);
  const counted = files.filter((f) => !f.binary && !skip.some((re) => re.test(f.path)));
  const lines = counted.reduce((n, f) => n + f.lines, 0);
  const over = lines > maxLines;
  const top = [...counted].sort((a, b) => b.lines - a.lines || (a.path < b.path ? -1 : 1));
  const details = capDetails([
    `센 파일 ${counted.length}개 · 제외한 파일 ${files.length - counted.length}개(생성 파일·테스트·문서·lockfile·바이너리)`,
    ...(over
      ? [
          '고치는 법: step을 더 잘게 나눠라. 기능 변경과 리팩터는 다른 PR로 나눈다. 경고이며 병합을 막지 않는다',
          `근거: ${DOC}`,
        ]
      : []),
    // 경로는 보이는 표기로 적는다(파일 이름의 줄바꿈이 줄을 늘리지 않는다). 견줄 때는 위에서 원래 글자를 썼다
    ...top.slice(0, FILE_LIMIT).map((f) => `${String(f.lines).padStart(6)}  ${showPath(f.path)}`),
    ...(top.length > FILE_LIMIT ? [`… 외 ${top.length - FILE_LIMIT}개`] : []),
  ]);
  const description = over
    ? `${WARN_PREFIX}변경 ${lines}줄이 상한 ${maxLines}줄을 넘는다(생성 파일·테스트·문서 제외)`
    : `통과 (변경 ${lines}줄 / 상한 ${maxLines}줄)`;
  return { state: 'success', description, details, lines, over };
}

export function prSize(o: { root: string; base: string; cfg: HarnessConfig }): PrSizeResult {
  return prSizeOf(changedLines(o.root, o.base), o.cfg);
}
