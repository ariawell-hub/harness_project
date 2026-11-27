// changes-collect: 변경 조각(`docs/harness/changes/`)을 CHANGELOG "다음 버전 (미배포)"와 설계서 변경 이력으로 옮기고
// 조각 파일을 지운다(TD-39, Issue #222. 모으기 PR, 절차서 5절). 제작자가 지시할 때 모으기 PR을 여는 세션이 돌린다.
// 문제가 하나라도 있으면 아무 파일도 쓰지 않는다. 링크를 따라가지 않고, 하드 링크로 이어진 파일에 쓰지 않는다.
// 기록 파일은 링크를 따라가지 않고 연 핸들로 한 번 읽고, 쓰기·지우기는 폴더를 작업 폴더로 고정해 원래 파일을 임시 이름으로
// 옮겨 다시 확인한 뒤 새 파일로 게시하거나 지운다. 되돌리는 명령은 알릴 때 다시 본다(Issue #257).
// git은 읽기(`git ls-tree`, `git status`)만 쓴다. 스테이징·커밋·되돌리기는 PR을 여는 세션이 확인하고 한다.
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import path from 'node:path';
import { CHANGES_DIR, collectFragments, isFragmentPath } from '../lib/changes.ts';
import { DESIGN_DOC } from '../lib/design-version.ts';
import { gitTry } from '../lib/git.ts';
import { log, today } from '../lib/util.ts';

const CHANGELOG_DOC = 'docs/harness/CHANGELOG.md';
/** 모으기가 읽고 바꾸는 자리(리포 루트 기준) */
const RECORDS = [DESIGN_DOC, CHANGELOG_DOC, CHANGES_DIR];
/** 도중에 실패한 모으기를 HEAD로 되돌리는 명령(출력만 한다. 실행하지 않는다) */
export const RESTORE_COMMAND = restoreCommand(RECORDS);

/** 그 자리들을 HEAD로 되돌리는 명령(출력만 한다) */
function restoreCommand(paths: string[]): string {
  return `git restore --source=HEAD --staged --worktree -- ${paths.join(' ')}`;
}

/**
 * 테스트용: 쓰기·지우기. `writeFile`은 논리 경로 `rel`(예: `docs/harness/CHANGELOG.md`)의 결과를 새 파일의 핸들 `fd`에
 * 쓴다(경로로 쓰지 않는다). 원래 파일을 임시 이름으로 옮겨 확인한 뒤 게시 전에 불린다. `unlink`는 작업 폴더(조각 폴더)
 * 안의 임시 이름(끝이 조각 이름)으로 불린다
 */
export interface CollectFs {
  writeFile: (rel: string, text: string, fd: number) => void;
  unlink: (name: string) => void;
  /** 결과를 담을 새 파일을 연다(작업 폴더 안의 이름). 기본은 `openSync` */
  openNew: (name: string, flags: number, mode: number) => number;
}

/**
 * 테스트용 고리: `afterRead`는 기록 파일을 한 번 읽은 직후, `beforeChange`는 그 파일을 이름으로 확인한 뒤 임시 이름으로
 * 옮기기 직전, `beforeWrite`는 결과를 담을 새 파일을 연 뒤 핸들에 쓰기 직전에 불린다(기본 쓰기·지우기를 그대로 두고
 * 확인과 변경 사이의 경쟁을 재현한다, Issue #257)
 */
export interface CollectHooks {
  afterRead?: (rel: string) => void;
  beforeChange?: (rel: string) => void;
  beforeWrite?: (rel: string) => void;
}

/** 파일·폴더의 식별자(링크를 따라가지 않은 자리, Windows의 파일 색인 번호도 잃지 않게 bigint) */
interface Ident {
  dev: bigint;
  ino: bigint;
}
const sameIdent = (a: Ident, b: Ident) => a.dev === b.dev && a.ino === b.ino;
/** 파일 이름 한도(바이트). 대부분의 파일 시스템이 이름 하나에 255바이트까지 받는다 */
const NAME_MAX = 255;
/**
 * 같은 폴더 안의 임시 이름: 이 실행만 아는 임의 값(+ 표시) + 원래 이름. 한도를 넘으면 원래 이름의 끝만 남긴다(계획 검증
 * F6). 기록 파일·조각 이름은 ASCII(`lib/changes.ts`의 이름 규칙)라 글자 수가 바이트 수다
 */
function tempName(name: string, mark = ''): string {
  const head = `.collect-${randomBytes(6).toString('hex')}-${mark}`;
  const room = NAME_MAX - Buffer.byteLength(head);
  return head + (Buffer.byteLength(name) > room ? name.slice(name.length - room) : name);
}

/** 그 자리에서 멈춘 까닭(사용자에게 보일 한 줄을 담는다) */
class Stop extends Error {
  text(): string {
    return this.message;
  }
}
/** 확인이 어긋난 자리(파일·폴더). 그 자리에서 멈춘다 */
class Changed extends Error {
  readonly rel: string;
  readonly kind: 'file' | 'dir' | 'content';
  constructor(rel: string, kind: 'file' | 'dir' | 'content') {
    super(kind);
    this.rel = rel;
    this.kind = kind;
  }
  /** 사용자에게 보일 한 줄 */
  text(): string {
    if (this.kind === 'content')
      return `${this.rel}: 읽은 뒤 바뀌었다(다른 프로세스가 저장했다). 건드리지 않고 그대로 두었다`;
    if (this.kind === 'file')
      return `${this.rel}: 처음 검사한 그 파일이 아니다(링크나 다른 파일로 바뀌었거나 하드 링크가 생겼다). 건드리지 않고 그대로 두었다`;
    return `${this.rel}: 처음 검사한 그 폴더가 아니다(링크나 다른 폴더로 바뀌었다). 건드리지 않고 그대로 두었다. 그 폴더를 제자리에 돌려놓아라. 아래에 되돌리는 명령이 있으면 그 뒤에 실행하라`;
  }
}

type Kind = 'none' | 'dir' | 'file' | 'link' | 'other';

/** 링크를 따라가지 않고 자리의 종류를 본다. 읽지 못하면(ENOENT 밖의 오류) 던진다 */
function kindOf(abs: string): Kind {
  try {
    const s = lstatSync(abs);
    return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other';
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return 'none';
    throw e;
  }
}

/**
 * 파일 바이트가 그 git blob(`oid`, SHA-1 또는 SHA-256 리포)과 바이트 그대로 같은가. 줄 끝을 바꿔 보지 않는다(판정 F1
 * 2회차: 줄 끝만 CRLF로 바꾼 숨긴 수정도 커밋하지 않은 바이트다). 이 리포는 `.gitattributes`로 작업 트리를 LF로 두므로
 * 같은 파일이면 바이트가 같다. 줄 끝을 바꿔 꺼내는 체크아웃에서는 다르다고 보아 모으지 않는다(막는 쪽).
 * git 명령을 더 띄우지 않고 객체 id를 직접 계산한다
 */
function sameAsBlob(content: Buffer, oid: string): boolean {
  const algo = oid.length === 64 ? 'sha256' : 'sha1';
  const id = createHash(algo).update(`blob ${content.length}\0`).update(content).digest('hex');
  return id === oid;
}

const KIND_TEXT: Record<Kind, string> = {
  none: '없다',
  dir: '폴더다',
  file: '파일이다',
  link: '심볼릭 링크다',
  other: '일반 파일·폴더가 아니다',
};

/** `changes-collect`: 변경 조각을 CHANGELOG·설계서 변경 이력으로 옮기고 조각 파일을 지운다. 종료 코드를 돌려준다 */
export function runChangesCollect(
  root: string,
  o: { date?: string; fs?: Partial<CollectFs>; noFollow?: boolean; hooks?: CollectHooks } = {},
): number {
  const fs: CollectFs = {
    writeFile: (_f, t, fd) => {
      const b = Buffer.from(t, 'utf8');
      for (let at = 0; at < b.length;) at += writeSync(fd, b, at, b.length - at, at);
    },
    unlink: (f) => unlinkSync(f),
    openNew: (n, flags, mode) => openSync(n, flags, mode),
    ...o.fs,
  };
  // 링크를 따라가지 않고, FIFO로 바뀐 자리에서 막히지 않게 연다. 없는 플랫폼(Windows)은 0이고 식별자 비교로 막는다.
  // 테스트는 noFollow: false로 그 경로를 본다
  const OPEN_FLAGS =
    (o.noFollow === false ? 0 : (constants.O_NOFOLLOW ?? 0)) | (constants.O_NONBLOCK ?? 0);
  const hooks = o.hooks ?? {};
  const abs = (rel: string) => path.join(root, ...rel.split('/'));
  const out = (line: string) => log(`changes-collect: ${line}`);
  const fail = (problems: string[], restore: boolean): number => {
    for (const p of problems) out(p);
    if (restore) {
      out('앞선 모으기가 중간에 실패했으면 아래 명령으로 되돌린 뒤 다시 실행하라');
      out(`되돌리는 명령: ${RESTORE_COMMAND}`);
    }
    out('실패 — 아무 파일도 바꾸지 않았다');
    return 1;
  };

  try {
    // 1. 폴더 경계: 조각 폴더가 비었는지 보기 전에 링크가 아닌 실제 폴더인지 본다(링크가 가리키는 빈 폴더도 막는다).
    // 위 폴더부터 보고 실제 폴더가 아닌 것을 만나면 그 자리에서 멈춘다: 그 아래 경로는 링크 너머를 읽는다(판정 F2)
    for (const d of ['docs', 'docs/harness']) {
      const k = kindOf(abs(d));
      if (k !== 'dir')
        return fail([`${d}: 심볼릭 링크가 아닌 실제 폴더여야 한다(${KIND_TEXT[k]})`], false);
    }
    const dirKind = kindOf(abs(CHANGES_DIR));
    if (dirKind !== 'none' && dirKind !== 'dir')
      return fail([`${CHANGES_DIR}: 없거나 실제 폴더여야 한다(${KIND_TEXT[dirKind]})`], false);
    // 쓰기·지우기 직전에 같은 폴더인지 볼 식별자(Issue #257)
    const dirIdent = new Map<string, Ident>();
    for (const d of ['docs', 'docs/harness', CHANGES_DIR])
      if (kindOf(abs(d)) === 'dir') dirIdent.set(d, lstatSync(abs(d), { bigint: true }));

    // 2. 모을 조각이 없으면 아무것도 바꾸지 않는다
    const names = dirKind === 'dir' ? readdirSync(abs(CHANGES_DIR)).sort() : [];
    if (names.length === 0) {
      out('모을 조각 없음');
      return 0;
    }
    const fragRels = names.map((n) => `${CHANGES_DIR}/${n}`);
    const files = [DESIGN_DOC, CHANGELOG_DOC, ...fragRels];
    const problems: string[] = [];

    // 3. 파일 경계: 링크가 아닌 일반 파일이고 하드 링크 수가 1이다. 조각 폴더 안은 조각 자리의 파일만 둔다.
    // 식별자(dev·ino)를 기록해 읽기·쓰기·지우기 때 그 파일인지 본다(Issue #257)
    const plain = new Set<string>();
    const fileIdent = new Map<string, Ident>();
    for (const rel of files) {
      const s = lstatSync(abs(rel), { throwIfNoEntry: false, bigint: true });
      if (!s) problems.push(`${rel}: 없다`);
      else if (s.isSymbolicLink()) problems.push(`${rel}: 심볼릭 링크다(일반 파일만 받는다)`);
      else if (!s.isFile()) problems.push(`${rel}: 일반 파일이 아니다`);
      else if (s.nlink !== 1n)
        problems.push(
          `${rel}: 하드 링크 수가 ${s.nlink}이다(다른 이름과 이어진 파일에는 쓰지 않는다)`,
        );
      else {
        plain.add(rel);
        fileIdent.set(rel, s);
      }
    }
    for (const rel of fragRels)
      if (!isFragmentPath(rel))
        problems.push(
          `${rel}: 조각 파일의 자리·이름이 아니다(${CHANGES_DIR}/<브랜치 이름의 / 뒤>.md)`,
        );

    // 4. 상태 확인: 커밋하지 않은 변경이 없다(앞선 모으기가 남긴 변경이면 항목이 두 번 옮겨진다).
    // 한 번 읽기(5)보다 먼저 본다. 그 뒤의 수정은 5의 바이트와 HEAD blob 비교(6)와 쓰기·지우기 직전 확인이 잡는다
    let restore = false;
    const status = gitTry(
      ['status', '--porcelain', '--untracked-files=all', '--', ...RECORDS],
      root,
    );
    if (!status.ok) {
      problems.push('기록 파일의 상태를 읽지 못했다(git status)');
      restore = true;
    } else if (status.stdout.trim() !== '') {
      const lines = status.stdout.split('\n').filter((l) => l.trim());
      problems.push(`커밋하지 않은 변경이 있다: ${lines.map((l) => l.trim()).join(', ')}`);
      restore = true;
    }

    // 5. 한 번 읽기: 링크를 따라가지 않고 연 핸들이 3에서 본 그 파일(일반 파일, 하드 링크 1, 식별자 같음)일 때만 읽는다.
    // 이 바이트를 HEAD 확인(6), 모으기 계산(7), 쓰기·지우기 직전의 변경 확인(8)에 함께 쓴다(경로로 다시 읽지 않는다)
    const openChecked = (rel: string, at: string, flags: number): number => {
      const want = fileIdent.get(rel);
      let fd: number;
      try {
        fd = openSync(at, flags | OPEN_FLAGS);
      } catch (e) {
        // 링크라 열리지 않음(ELOOP, 일부 플랫폼 EMLINK)이나 사라짐: 그 파일이 아니다
        const code = (e as NodeJS.ErrnoException).code;
        if (code === 'ELOOP' || code === 'EMLINK' || code === 'ENOENT')
          throw new Changed(rel, 'file');
        throw e;
      }
      try {
        const st = fstatSync(fd, { bigint: true });
        if (!want || !st.isFile() || st.nlink !== 1n || !sameIdent(st, want))
          throw new Changed(rel, 'file');
        return fd;
      } catch (e) {
        closeSync(fd);
        throw e;
      }
    };
    /**
     * 핸들의 처음부터 EOF까지 읽는다. 처음 `fstat`의 크기에 기대지 않는다: 읽는 도중 끝에 덧붙은 바이트도 읽어 견준다
     * (Issue #261 판정 F1)
     */
    const readAll = (fd: number): Buffer => {
      const chunks: Buffer[] = [];
      let at = 0;
      for (;;) {
        const b = Buffer.alloc(64 * 1024);
        const n = readSync(fd, b, 0, b.length, at);
        if (n === 0) break;
        chunks.push(n === b.length ? b : b.subarray(0, n));
        at += n;
      }
      return Buffer.concat(chunks, at);
    };
    const readBytes = new Map<string, Buffer>();
    for (const rel of files) {
      if (!plain.has(rel)) continue;
      try {
        const fd = openChecked(rel, abs(rel), constants.O_RDONLY);
        try {
          readBytes.set(rel, readAll(fd));
        } finally {
          closeSync(fd);
        }
      } catch (e) {
        if (!(e instanceof Changed)) throw e;
        problems.push(e.text());
        continue;
      }
      hooks.afterRead?.(rel);
    }

    // 6. 커밋 확인: 지운 조각과 고친 기록 파일을 HEAD에서 되돌릴 수 있어야 한다(git이 무시하는 파일도 막는다).
    // 5에서 읽은 바이트가 HEAD의 blob과 같은지도 본다: 색인 표시(assume-unchanged, skip-worktree)로 git status에
    // 보이지 않는 수정은 HEAD로 되돌릴 수 없어, 그 파일을 읽어 옮기고 지우면 수정이 사라진다(판정 F1)
    const tree = gitTry(['ls-tree', '-r', '-z', 'HEAD', '--', ...RECORDS], root);
    if (!tree.ok) {
      problems.push('HEAD의 기록 파일 목록을 읽지 못했다(git ls-tree)');
      restore = true;
    } else {
      const committed = new Map<string, { mode: string; oid: string }>();
      for (const entry of tree.stdout.split('\0').filter(Boolean)) {
        const m = /^(\d+) blob ([0-9a-f]+)\t(.+)$/s.exec(entry);
        if (m) committed.set(m[3], { mode: m[1], oid: m[2] });
      }
      for (const rel of files) {
        const c = committed.get(rel);
        const bytes = readBytes.get(rel);
        if (!c) {
          problems.push(`${rel}: HEAD에 커밋되지 않은 파일이다(git이 무시하는 파일 포함)`);
          restore = true;
        } else if (c.mode !== '100644' && c.mode !== '100755') {
          problems.push(`${rel}: HEAD에서 일반 파일이 아니다(모드 ${c.mode})`);
        } else if (bytes && !sameAsBlob(bytes, c.oid)) {
          problems.push(
            `${rel}: HEAD에 커밋된 내용과 다르다(줄 끝 포함 바이트로 견준다. git status에 보이지 않는 색인 표시가 있을 수 있다. git ls-files -v로 보고, 수정을 커밋하거나 표시를 푼 뒤 다시 실행하라)`,
          );
        }
      }
    }
    if (problems.length) return fail(problems, restore);

    // 7. 계산한다(문제가 있으면 아무것도 쓰지 않는다). 5의 바이트를 쓴다
    const textOf = (rel: string) => (readBytes.get(rel) ?? Buffer.alloc(0)).toString('utf8');
    const design = textOf(DESIGN_DOC);
    const changelog = textOf(CHANGELOG_DOC);
    const fragments = fragRels.map((rel) => ({ rel, text: textOf(rel) }));
    const r = collectFragments({ design, changelog, fragments, date: o.date ?? today() });
    if (!r.ok) return fail(r.problems, false);

    // 8. 쓰고 지운다(Issue #257). 쓰기는 `docs/harness`를, 지우기는 조각 폴더를 작업 폴더로 고정해 이름으로 다룬다: 그 뒤
    // 폴더 경로가 링크로 바뀌어도 작업 폴더는 확인한 폴더 자체다(Node에 openat·unlinkat이 없다). 파일마다 (ㄱ) 이름으로
    // 그 파일이고 5의 바이트와 같은지 보고, (ㄴ) 이 실행만 아는 임시 이름으로 옮기고(rename은 그 순간 그 이름에 있는 것을
    // 옮긴다), (ㄷ) 임시 이름에서 다시 본다. 어긋나면 덮어쓰지 않고 제자리로 돌려놓고 멈춘다(판정 F6, 계획 검증 F5).
    // 쓰기는 결과를 새 파일에 써서 덮어쓰지 않는 하드 링크로 게시한다: 원래 inode에는 쓰지 않는다(판정 F10)
    const checkDirs = () => {
      for (const [d, want] of dirIdent) {
        const st = lstatSync(abs(d), { throwIfNoEntry: false, bigint: true });
        if (!st || !st.isDirectory() || !sameIdent(st, want)) throw new Changed(d, 'dir');
      }
    };
    /** 그 폴더를 작업 폴더로 삼아 fn을 부른다. 들어간 직후 `.`이 시작 때의 그 폴더인지 본다. 끝나면 원래 작업 폴더로 */
    const inDir = (dirRel: string, fn: () => void) => {
      checkDirs();
      const want = dirIdent.get(dirRel);
      const back = process.cwd();
      process.chdir(abs(dirRel));
      try {
        const here = lstatSync('.', { bigint: true });
        if (!want || !here.isDirectory() || !sameIdent(here, want))
          throw new Changed(dirRel, 'dir');
        fn();
      } finally {
        process.chdir(back);
      }
    };
    /** 작업 폴더 안의 이름 `at`이 3에서 본 그 파일(링크 수 1)이고 내용이 5의 바이트와 같은가. 권한 비트를 돌려준다 */
    const verifyAt = (rel: string, at: string): number => {
      const st = lstatSync(at, { throwIfNoEntry: false, bigint: true });
      const want = fileIdent.get(rel);
      if (!st || !want || !st.isFile() || !sameIdent(st, want)) throw new Changed(rel, 'file');
      const fd = openChecked(rel, at, constants.O_RDONLY);
      try {
        if (!readAll(fd).equals(readBytes.get(rel) ?? Buffer.alloc(0)))
          throw new Changed(rel, 'content');
      } finally {
        closeSync(fd);
      }
      return Number(st.mode & 0o777n);
    };
    /** 작업 폴더 안의 이름 `at`이 3에서 본 그 파일(식별자)이고 내용이 5의 바이트와 같은가(링크 수는 보지 않는다) */
    const sameBytesAt = (rel: string, at: string): boolean => {
      const want = fileIdent.get(rel);
      const st = lstatSync(at, { throwIfNoEntry: false, bigint: true });
      if (!st || !want || !st.isFile() || !sameIdent(st, want)) return false;
      const fd = openSync(at, constants.O_RDONLY | OPEN_FLAGS);
      try {
        const before = fstatSync(fd, { bigint: true });
        if (!before.isFile() || !sameIdent(before, want)) return false;
        const bytes = readAll(fd);
        // 읽는 동안 바뀌었으면(크기·수정 시각) 같다고 보지 않는다(Issue #261 판정 F1)
        const after = fstatSync(fd, { bigint: true });
        return (
          after.size === BigInt(bytes.length) &&
          after.size === before.size &&
          after.mtimeNs === before.mtimeNs &&
          bytes.equals(readBytes.get(rel) ?? Buffer.alloc(0))
        );
      } finally {
        closeSync(fd);
      }
    };
    /** 임시 이름의 것을 덮어쓰지 않고 제자리 이름으로 돌려놓는다(그 이름에 무엇이 있으면 실패하고 임시 이름에 남긴다) */
    const putBack = (rel: string, dirRel: string, parked: string, name: string, cause: unknown) => {
      try {
        if (lstatSync(parked).isSymbolicLink()) symlinkSync(readlinkSync(parked), name);
        else linkSync(parked, name);
        unlinkSync(parked);
      } catch (e) {
        return new Stop(
          `${rel}: 확인이 어긋나 제자리로 돌려놓으려 했으나 못 해(${(e as Error).message}) ${dirRel}/${parked}에 남겼다. 내용을 확인해 제자리로 옮긴 뒤 다시 실행하라`,
        );
      }
      return cause instanceof Error ? cause : new Error(String(cause));
    };
    /** (ㄱ)·(ㄴ)·(ㄷ): 확인하고 임시 이름으로 옮겨 다시 확인한다. 임시 이름과 권한 비트를 돌려준다 */
    const moveAside = (rel: string, dirRel: string, name: string) => {
      verifyAt(rel, name);
      hooks.beforeChange?.(rel);
      const parked = tempName(name);
      renameSync(name, parked);
      try {
        return { parked, mode: verifyAt(rel, parked) };
      } catch (e) {
        throw putBack(rel, dirRel, parked, name, e);
      }
    };
    /** 실패 처리에서 지우지 않고 남긴 임시 파일(이 명령이 만들었다. 확인 뒤 지우라고 알린다, 계획 검증 F19) */
    const leftovers: string[] = [];
    // 되돌리기 목록: 실제로 게시했거나 지운 파일만(게시·지우기 직전에 넣고 실패하면 뺀다). 게시한 파일의 식별자를 기록한다
    const touched: string[] = [];
    /** 게시한 파일의 식별자와 바이트 */
    const written = new Map<string, { ident: Ident; bytes: Buffer }>();
    /** 자동으로 되돌리지 않는 파일(게시한 자리가 그 파일이 아니었다) */
    const forced: string[] = [];
    let doing = '';
    const HARNESS_DIR = 'docs/harness';
    /**
     * 결과를 새 파일의 핸들에 써서 제자리 이름에 덮어쓰지 않고 게시한다(작업 폴더는 docs/harness). 게시 직전에 새 파일
     * 이름이 그 핸들의 파일인지, 게시 직후 제자리 이름이 그 파일인지 본다(판정 F4)
     */
    const write = (rel: string, text: string) => {
      doing = `${rel} 쓰기`;
      const name = rel.slice(HARNESS_DIR.length + 1);
      const { parked, mode } = moveAside(rel, HARNESS_DIR, name);
      const fresh = tempName(name, 'new-');
      let made: Ident | undefined;
      // 새 파일 열기·쓰기를 한 블록으로 묶는다: 어느 쪽이 실패해도 이 명령이 만든 그 새 파일만 지우고 원래 파일을
      // 제자리로 돌려놓는다(게시 전이라 목록에 넣지 않는다, 계획 검증 F3)
      try {
        const fd = fs.openNew(
          fresh,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | OPEN_FLAGS,
          mode,
        );
        try {
          made = fstatSync(fd, { bigint: true });
          // 만들 때 준 권한은 umask로 줄어든다. 원래 파일의 권한 비트를 그 핸들에 다시 준다(판정 F23)
          fchmodSync(fd, mode);
          hooks.beforeWrite?.(rel);
          fs.writeFile(rel, text, fd);
        } finally {
          closeSync(fd);
        }
      } catch (e) {
        // 새 파일 이름은 지우지 않는다: 이 명령이 만들었으면 알리고, 열지 못했으면 건드리지 않는다(계획 검증 F17·F19)
        if (made) leftovers.push(`${HARNESS_DIR}/${fresh}`);
        throw putBack(rel, HARNESS_DIR, parked, name, e);
      }
      // 새 파일 이름이 여전히 그 파일인가(그 사이 링크나 다른 파일로 바뀌었으면 게시하지 않는다. 그 이름은 그대로 둔다)
      const st = lstatSync(fresh, { throwIfNoEntry: false, bigint: true });
      if (!st || !st.isFile() || !sameIdent(st, made))
        throw putBack(
          rel,
          HARNESS_DIR,
          parked,
          name,
          new Stop(
            `${rel}: 결과를 쓴 새 파일(${HARNESS_DIR}/${fresh})이 그 사이 바뀌어 게시하지 않았다. 원래 파일은 제자리에 돌려놓았다`,
          ),
        );
      touched.push(rel);
      try {
        linkSync(fresh, name);
      } catch (e) {
        touched.pop();
        leftovers.push(`${HARNESS_DIR}/${fresh}`);
        if ((e as NodeJS.ErrnoException).code === 'EEXIST')
          throw new Stop(
            `${rel}: 그 사이 다른 세션이 이 이름으로 새 파일을 저장해 결과를 쓰지 않았다(그 파일은 그대로 두었다). 원래 파일은 ${HARNESS_DIR}/${parked}에 남겼다(HEAD와 같은 내용). 확인한 뒤 지워라`,
          );
        throw putBack(rel, HARNESS_DIR, parked, name, e);
      }
      // 게시한 자리가 그 파일인가(아니면 자동으로 되돌리지 않는다)
      const pub = lstatSync(name, { throwIfNoEntry: false, bigint: true });
      if (!pub || !pub.isFile() || !sameIdent(pub, made)) {
        touched.pop();
        forced.push(rel);
        throw new Stop(
          `${rel}: 게시한 자리가 결과를 쓴 그 파일이 아니다. 새 파일 ${HARNESS_DIR}/${fresh}와 원래 파일 ${HARNESS_DIR}/${parked}를 남겼다`,
        );
      }
      written.set(rel, { ident: made, bytes: Buffer.from(text, 'utf8') });
      unlinkSync(fresh);
      // 게시하는 동안 원래 파일을 미리 열어 둔 다른 세션이 그 핸들로 저장했을 수 있다: 지우기 직전에 식별자와 바이트를
      // 다시 견주고, 어긋나면 지우지 않고 남긴다(Issue #261, PR #254 판정 F5). 링크 수는 보지 않는다: 하드 링크가 더해져도
      // 지우는 것은 이 명령의 임시 이름 하나이고 내용은 그 링크에 남는다
      try {
        if (!sameBytesAt(rel, parked)) throw new Error('바뀌었다');
      } catch {
        leftovers.push(`${HARNESS_DIR}/${parked}`);
        throw new Stop(
          `${rel}: 게시한 뒤 원래 파일이 바뀌었다(미리 열어 둔 다른 세션이 저장했다). 원래 파일을 지우지 않고 ${HARNESS_DIR}/${parked}에 남겼다. 그 내용을 확인해 옮겨라`,
        );
      }
      unlinkSync(parked);
    };
    /** 조각을 임시 이름으로 옮겨 확인한 뒤 지운다(작업 폴더는 조각 폴더) */
    const remove = (rel: string) => {
      doing = `${rel} 지우기`;
      const name = rel.slice(CHANGES_DIR.length + 1);
      const { parked } = moveAside(rel, CHANGES_DIR, name);
      touched.push(rel);
      try {
        fs.unlink(parked);
      } catch (e) {
        // 지우지 못한 조각은 목록에서 뺀다: 돌려놓았으면 바뀐 것이 없고, 못 돌려놓았으면 원래 이름에 다른 세션의
        // 파일이 있을 수 있어 HEAD로 되돌리면 그 파일을 덮어쓴다(계획 검증 F7)
        touched.pop();
        throw putBack(rel, CHANGES_DIR, parked, name, e);
      }
    };
    /**
     * 알릴 때 되돌리기 목록을 다시 본다(판정 F11·F13): 그 파일의 상위 폴더가 처음과 같고, 게시한 파일은 그 경로가 게시한
     * 그 파일이며 링크를 따라가지 않고 연 핸들로 읽은 내용이 게시한 바이트와 같고, 지운 조각은 그 경로에 아무것도 없을 때만
     * 자동으로 되돌린다. 아니면 그 뒤 다른 세션이 바꿨거나 폴더가 바뀌었다
     */
    const stillWritten = (rel: string, w: { ident: Ident; bytes: Buffer }): boolean => {
      const st = lstatSync(abs(rel), { throwIfNoEntry: false, bigint: true });
      if (!st || !st.isFile() || !sameIdent(st, w.ident)) return false;
      let fd: number;
      try {
        fd = openSync(abs(rel), constants.O_RDONLY | OPEN_FLAGS);
      } catch {
        return false;
      }
      try {
        const f = fstatSync(fd, { bigint: true });
        return f.isFile() && sameIdent(f, w.ident) && readAll(fd).equals(w.bytes);
      } finally {
        closeSync(fd);
      }
    };
    /**
     * 그 파일을 자동으로 되돌려도 되는가. 위 폴더부터 보고 바뀐 폴더를 만나면 그 아래는 보지 않는다(링크 너머이거나
     * 폴더가 아닐 수 있다). 보는 동안의 오류(`ENOTDIR` 등)도 자동으로 되돌리지 않는 쪽으로 본다(판정 F22)
     */
    const restorable = (rel: string): boolean => {
      try {
        for (const [d, want] of dirIdent) {
          if (!rel.startsWith(`${d}/`)) continue;
          const st = lstatSync(abs(d), { throwIfNoEntry: false, bigint: true });
          if (!st || !st.isDirectory() || !sameIdent(st, want)) return false;
        }
        const w = written.get(rel);
        return w ? stillWritten(rel, w) : !lstatSync(abs(rel), { throwIfNoEntry: false });
      } catch {
        return false;
      }
    };
    const sortLeft = () => {
      const auto: string[] = [];
      const manual: string[] = [...forced];
      for (const rel of touched) (restorable(rel) ? auto : manual).push(rel);
      return { auto, manual };
    };
    try {
      inDir(HARNESS_DIR, () => {
        if (r.design !== design) write(DESIGN_DOC, r.design);
        write(CHANGELOG_DOC, r.changelog);
      });
      inDir(CHANGES_DIR, () => {
        for (const rel of fragRels) remove(rel);
      });
      // 모두 끝난 뒤 폴더 셋을 한 번 더 본다(그 사이 폴더가 바뀌었으면 알린다)
      checkDirs();
    } catch (e) {
      out(
        e instanceof Changed || e instanceof Stop
          ? e.text()
          : `${doing} 실패: ${(e as Error).message}`,
      );
      const { auto, manual } = sortLeft();
      if (leftovers.length)
        out(
          `남긴 임시 파일: ${leftovers.join(', ')}(이 명령이 만든 파일이다. 내용을 확인한 뒤 지워라)`,
        );
      if (auto.length === 0 && manual.length === 0) {
        out('실패 — 아무 파일도 바꾸지 않았다');
        return 1;
      }
      if (auto.length) {
        out(
          '모으기가 중간에 멈췄다. 아래 명령으로 이 명령이 바꾸거나 지운 파일만 되돌린 뒤 다시 실행하라',
        );
        out(`되돌리는 명령: ${restoreCommand(auto)}`);
      }
      if (manual.length)
        out(
          `자동으로 되돌리지 않는 파일: ${manual.join(', ')}(이 명령이 바꾸거나 지웠지만 그 뒤 다른 세션이 바꿨거나 폴더가 바뀌었다. 직접 확인하라)`,
        );
      return 1;
    }
    out(
      `조각 ${fragRels.length}개, CHANGELOG 항목 ${r.items}개, 설계서 ${r.versions.length ? r.versions.join(', ') : '그대로'}`,
    );
    return 0;
  } catch (e) {
    return fail([e instanceof Changed ? e.text() : `읽지 못했다: ${(e as Error).message}`], false);
  }
}
