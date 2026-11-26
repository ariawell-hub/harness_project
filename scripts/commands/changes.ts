// changes-collect: 변경 조각(`docs/harness/changes/`)을 CHANGELOG "다음 버전 (미배포)"와 설계서 변경 이력으로 옮기고
// 조각 파일을 지운다(TD-39, Issue #222. 모으기 PR, 절차서 5절). 제작자가 지시할 때 모으기 PR을 여는 세션이 돌린다.
// 문제가 하나라도 있으면 아무 파일도 쓰지 않는다. 링크를 따라가지 않고, 하드 링크로 이어진 파일에 쓰지 않는다.
// 쓰기·지우기 직전마다 파일·폴더가 시작 검사 때의 그것(dev·ino)인지 보고, 쓰기는 확인한 핸들로 한다(Issue #257).
// git은 읽기(`git ls-tree`, `git status`)만 쓴다. 스테이징·커밋·되돌리기는 PR을 여는 세션이 확인하고 한다.
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  constants,
  fstatSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
  renameSync,
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
 * 테스트용: 쓰기·지우기. 기본 쓰기는 확인을 마친 핸들(`fd`)을 비우고 처음부터 쓴다. 기본 지우기는 `unlinkSync`로,
 * 조각 폴더가 작업 폴더일 때 조각 파일 이름으로 불린다. 주입한 함수도 확인을 마친 뒤에 불린다
 */
export interface CollectFs {
  writeFile: (file: string, text: string, fd: number) => void;
  unlink: (name: string) => void;
}

/**
 * 테스트용 고리: `afterRead`는 기록 파일을 한 번 읽은 직후, `beforeChange`는 그 파일의 확인을 마치고 되돌리기 목록에
 * 넣은 뒤 쓰기·지우기 직전에 불린다(기본 쓰기·지우기를 그대로 두고 확인과 변경 사이의 경쟁을 재현한다, Issue #257)
 */
export interface CollectHooks {
  afterRead?: (rel: string) => void;
  beforeChange?: (rel: string) => void;
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
 * 조각을 옮겨 둘 임시 이름: 이 실행만 아는 임의 값 + 조각 이름. 한도를 넘으면 조각 이름의 끝만 남긴다(계획 검증 F6).
 * 조각 이름은 ASCII(`lib/changes.ts`의 이름 규칙)라 글자 수가 바이트 수다
 */
function parkedName(name: string): string {
  const head = `.collect-${randomBytes(6).toString('hex')}-`;
  const room = NAME_MAX - Buffer.byteLength(head);
  return head + (Buffer.byteLength(name) > room ? name.slice(name.length - room) : name);
}

/** 조각을 임시 이름에서 제자리로 돌려놓지 못했다(그 이름에 이미 다른 파일이 있다 등). 임시 이름에 남겼다 */
class Parked extends Error {
  readonly rel: string;
  readonly where: string;
  readonly why: string;
  constructor(rel: string, where: string, why: string) {
    super(why);
    this.rel = rel;
    this.where = where;
    this.why = why;
  }
  text(): string {
    return `${this.rel}: 확인이 어긋나 제자리로 돌려놓으려 했으나 못 해(${this.why}) ${this.where}에 남겼다. 내용을 확인해 제자리로 옮긴 뒤 다시 실행하라`;
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
      ftruncateSync(fd, 0);
      const b = Buffer.from(t, 'utf8');
      for (let at = 0; at < b.length;) at += writeSync(fd, b, at, b.length - at, at);
    },
    unlink: (f) => unlinkSync(f),
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
    const readAll = (fd: number): Buffer => {
      const size = Number(fstatSync(fd, { bigint: true }).size);
      const b = Buffer.alloc(size);
      let at = 0;
      while (at < size) {
        const n = readSync(fd, b, at, size - at, at);
        if (n === 0) break;
        at += n;
      }
      return at === size ? b : b.subarray(0, at);
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

    // 8. 쓰고 지운다. 쓰기·지우기 직전마다 폴더 셋과 그 파일이 처음의 그것이고 5에서 읽은 뒤 바뀌지 않았는지 본다
    // (판정 F6, Issue #257): 그 사이 다른 프로세스가 저장했거나 링크로 바꿨으면 건드리지 않고 그 자리에서 멈춘다.
    // 파일은 확인을 모두 마친 뒤 첫 변경 직전에 되돌리기 목록에 넣는다. 되돌리는 명령은 이 명령이 바꾸거나 지운
    // 파일만 담는다(그 파일들은 6에서 HEAD와 바이트가 같았으므로 HEAD로 되돌려도 잃는 것이 없다)
    const checkDirs = () => {
      for (const [d, want] of dirIdent) {
        const st = lstatSync(abs(d), { throwIfNoEntry: false, bigint: true });
        if (!st || !st.isDirectory() || !sameIdent(st, want)) throw new Changed(d, 'dir');
      }
    };
    /** 링크를 따라가지 않고 열어 그 파일이고 내용이 5의 바이트와 같으면 핸들을 돌려준다 */
    const checkedFd = (rel: string, at: string, flags: number): number => {
      const fd = openChecked(rel, at, flags);
      try {
        if (!readAll(fd).equals(readBytes.get(rel) ?? Buffer.alloc(0)))
          throw new Changed(rel, 'content');
        return fd;
      } catch (e) {
        closeSync(fd);
        throw e;
      }
    };
    const touched: string[] = [];
    let doing = '';
    /** 확인한 핸들로 쓰고, 쓴 뒤 그 자리가 여전히 그 파일인지 본다 */
    const write = (rel: string, text: string) => {
      doing = `${rel} 쓰기`;
      checkDirs();
      const fd = checkedFd(rel, abs(rel), constants.O_RDWR);
      try {
        touched.push(rel);
        hooks.beforeChange?.(rel);
        fs.writeFile(abs(rel), text, fd);
      } finally {
        closeSync(fd);
      }
      // 폴더를 먼저 본다(폴더가 바뀌었으면 그 아래 파일 경로는 링크 너머다)
      checkDirs();
      const st = lstatSync(abs(rel), { throwIfNoEntry: false, bigint: true });
      const want = fileIdent.get(rel);
      if (!st || !want || !st.isFile() || !sameIdent(st, want)) throw new Changed(rel, 'file');
    };
    /**
     * 조각 폴더를 작업 폴더로 삼아 이름으로 확인하고 지운다. 작업 폴더는 확인한 폴더 자체를 가리켜, 그 뒤 폴더 경로가
     * 링크로 바뀌어도 링크 너머를 지우지 않는다(Node에 unlinkat이 없다). 끝나면(실패해도) 원래 작업 폴더로 돌아간다
     */
    const removeFragments = () => {
      checkDirs();
      const dirWant = dirIdent.get(CHANGES_DIR);
      const back = process.cwd();
      process.chdir(abs(CHANGES_DIR));
      try {
        const here = lstatSync('.', { bigint: true });
        if (!dirWant || !here.isDirectory() || !sameIdent(here, dirWant))
          throw new Changed(CHANGES_DIR, 'dir');
        /** 작업 폴더 안의 이름 `at`이 3에서 본 그 조각이고 내용이 5의 바이트와 같은가(아니면 던진다) */
        const verifyAt = (rel: string, at: string) => {
          const st = lstatSync(at, { throwIfNoEntry: false, bigint: true });
          const want = fileIdent.get(rel);
          if (!st || !want || !st.isFile() || !sameIdent(st, want)) throw new Changed(rel, 'file');
          closeSync(checkedFd(rel, at, constants.O_RDONLY));
        };
        /** 임시 이름의 파일을 덮어쓰지 않고 제자리 이름으로 돌려놓는다(그 이름에 무엇이 있으면 링크가 실패한다) */
        const putBack = (rel: string, parked: string, name: string, cause: unknown): Error => {
          try {
            linkSync(parked, name);
            unlinkSync(parked);
          } catch (e) {
            return new Parked(rel, `${CHANGES_DIR}/${parked}`, (e as Error).message);
          }
          return cause instanceof Error ? cause : new Error(String(cause));
        };
        for (const rel of fragRels) {
          const name = rel.slice(CHANGES_DIR.length + 1);
          doing = `${rel} 지우기`;
          // (ㄱ) 이름으로 그 조각이고 내용이 처음 읽은 바이트와 같은지 본다
          verifyAt(rel, name);
          hooks.beforeChange?.(rel);
          // (ㄴ) 이 실행만 아는 임시 이름으로 옮긴다. rename은 그 순간 그 이름에 있는 파일을 옮긴다
          const parked = parkedName(name);
          renameSync(name, parked);
          // (ㄷ) 옮긴 것이 확인한 그 조각인지 다시 본다. 아니면(그 사이 다른 세션이 같은 이름으로 저장했다)
          // 제자리로 돌려놓고 멈춘다. 지우기가 실패해도 돌려놓는다(계획 검증 F5)
          try {
            verifyAt(rel, parked);
          } catch (e) {
            throw putBack(rel, parked, name, e);
          }
          touched.push(rel);
          try {
            fs.unlink(parked);
          } catch (e) {
            // 지우지 못한 조각은 목록에서 뺀다: 돌려놓았으면 바뀐 것이 없고, 못 돌려놓았으면 원래 이름에 다른 세션의
            // 파일이 있을 수 있어 HEAD로 되돌리면 그 파일을 덮어쓴다(계획 검증 F7)
            touched.pop();
            throw putBack(rel, parked, name, e);
          }
        }
      } finally {
        process.chdir(back);
      }
      // 모두 끝난 뒤 폴더 셋을 한 번 더 본다(지우는 동안 폴더가 바뀌었으면 알린다)
      checkDirs();
    };
    try {
      if (r.design !== design) write(DESIGN_DOC, r.design);
      write(CHANGELOG_DOC, r.changelog);
      removeFragments();
    } catch (e) {
      out(
        e instanceof Changed || e instanceof Parked
          ? e.text()
          : `${doing} 실패: ${(e as Error).message}`,
      );
      if (touched.length === 0) {
        out('실패 — 아무 파일도 바꾸지 않았다');
        return 1;
      }
      out(
        '모으기가 중간에 멈췄다. 아래 명령으로 이 명령이 바꾸거나 지운 파일만 되돌린 뒤 다시 실행하라',
      );
      out(`되돌리는 명령: ${restoreCommand(touched)}`);
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
