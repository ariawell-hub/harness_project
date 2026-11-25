// changes-collect: 변경 조각(`docs/harness/changes/`)을 CHANGELOG "다음 버전 (미배포)"와 설계서 변경 이력으로 옮기고
// 조각 파일을 지운다(TD-39, Issue #222. 모으기 PR, 절차서 5절). 제작자가 지시할 때 모으기 PR을 여는 세션이 돌린다.
// 문제가 하나라도 있으면 아무 파일도 쓰지 않는다. 링크를 따라가지 않고, 하드 링크로 이어진 파일에 쓰지 않는다.
// git은 읽기(`git ls-tree`, `git status`)만 쓴다. 스테이징·커밋·되돌리기는 PR을 여는 세션이 확인하고 한다.
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CHANGES_DIR, collectFragments, isFragmentPath } from '../lib/changes.ts';
import { DESIGN_DOC } from '../lib/design-version.ts';
import { gitTry } from '../lib/git.ts';
import { log, today } from '../lib/util.ts';

const CHANGELOG_DOC = 'docs/harness/CHANGELOG.md';
/** 모으기가 읽고 바꾸는 자리(리포 루트 기준) */
const RECORDS = [DESIGN_DOC, CHANGELOG_DOC, CHANGES_DIR];
/** 도중에 실패한 모으기를 HEAD로 되돌리는 명령(출력만 한다. 실행하지 않는다) */
export const RESTORE_COMMAND = `git restore --source=HEAD --staged --worktree -- ${RECORDS.join(' ')}`;

/** 테스트용: 쓰기·지우기. 기본은 `node:fs`의 `writeFileSync`, `unlinkSync` */
export interface CollectFs {
  writeFile: (file: string, text: string) => void;
  unlink: (file: string) => void;
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
  o: { date?: string; fs?: Partial<CollectFs> } = {},
): number {
  const fs: CollectFs = {
    writeFile: (f, t) => writeFileSync(f, t),
    unlink: (f) => unlinkSync(f),
    ...o.fs,
  };
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

    // 2. 모을 조각이 없으면 아무것도 바꾸지 않는다
    const names = dirKind === 'dir' ? readdirSync(abs(CHANGES_DIR)).sort() : [];
    if (names.length === 0) {
      out('모을 조각 없음');
      return 0;
    }
    const fragRels = names.map((n) => `${CHANGES_DIR}/${n}`);
    const files = [DESIGN_DOC, CHANGELOG_DOC, ...fragRels];
    const problems: string[] = [];

    // 3. 파일 경계: 링크가 아닌 일반 파일이고 하드 링크 수가 1이다. 조각 폴더 안은 조각 자리의 파일만 둔다
    const plain = new Set<string>();
    for (const rel of files) {
      const s = lstatSync(abs(rel), { throwIfNoEntry: false });
      if (!s) problems.push(`${rel}: 없다`);
      else if (s.isSymbolicLink()) problems.push(`${rel}: 심볼릭 링크다(일반 파일만 받는다)`);
      else if (!s.isFile()) problems.push(`${rel}: 일반 파일이 아니다`);
      else if (s.nlink !== 1)
        problems.push(
          `${rel}: 하드 링크 수가 ${s.nlink}이다(다른 이름과 이어진 파일에는 쓰지 않는다)`,
        );
      else plain.add(rel);
    }
    for (const rel of fragRels)
      if (!isFragmentPath(rel))
        problems.push(
          `${rel}: 조각 파일의 자리·이름이 아니다(${CHANGES_DIR}/<브랜치 이름의 / 뒤>.md)`,
        );

    // 4. 커밋 확인: 지운 조각과 고친 기록 파일을 HEAD에서 되돌릴 수 있어야 한다(git이 무시하는 파일도 막는다).
    // 파일의 바이트가 HEAD의 blob과 같은지도 본다: 색인 표시(assume-unchanged, skip-worktree)로 git status에
    // 보이지 않는 수정은 HEAD로 되돌릴 수 없어, 그 파일을 읽어 옮기고 지우면 수정이 사라진다(판정 F1)
    let restore = false;
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
        if (!c) {
          problems.push(`${rel}: HEAD에 커밋되지 않은 파일이다(git이 무시하는 파일 포함)`);
          restore = true;
        } else if (c.mode !== '100644' && c.mode !== '100755') {
          problems.push(`${rel}: HEAD에서 일반 파일이 아니다(모드 ${c.mode})`);
        } else if (plain.has(rel) && !sameAsBlob(readFileSync(abs(rel)), c.oid)) {
          problems.push(
            `${rel}: HEAD에 커밋된 내용과 다르다(줄 끝 포함 바이트로 견준다. git status에 보이지 않는 색인 표시가 있을 수 있다. git ls-files -v로 보고, 수정을 커밋하거나 표시를 푼 뒤 다시 실행하라)`,
          );
        }
      }
    }
    // 5. 상태 확인: 커밋하지 않은 변경이 없다(앞선 모으기가 남긴 변경이면 항목이 두 번 옮겨진다)
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
    if (problems.length) return fail(problems, restore);

    // 6. 읽고 계산한다(문제가 있으면 아무것도 쓰지 않는다)
    const design = readFileSync(abs(DESIGN_DOC), 'utf8');
    const changelog = readFileSync(abs(CHANGELOG_DOC), 'utf8');
    const fragments = fragRels.map((rel) => ({ rel, text: readFileSync(abs(rel), 'utf8') }));
    const r = collectFragments({ design, changelog, fragments, date: o.date ?? today() });
    if (!r.ok) return fail(r.problems, false);

    // 8. 쓰고 지운다. 도중에 실패하면 그 자리에서 멈추고 되돌리는 명령을 낸다(다시 실행하면 5에서 막힌다)
    let doing = '';
    try {
      if (r.design !== design) {
        doing = `${DESIGN_DOC} 쓰기`;
        fs.writeFile(abs(DESIGN_DOC), r.design);
      }
      doing = `${CHANGELOG_DOC} 쓰기`;
      fs.writeFile(abs(CHANGELOG_DOC), r.changelog);
      for (const rel of fragRels) {
        doing = `${rel} 지우기`;
        fs.unlink(abs(rel));
      }
    } catch (e) {
      out(`${doing} 실패: ${(e as Error).message}`);
      out('모으기가 중간에 멈췄다. 아래 명령으로 되돌린 뒤 다시 실행하라');
      out(`되돌리는 명령: ${RESTORE_COMMAND}`);
      return 1;
    }
    out(
      `조각 ${fragRels.length}개, CHANGELOG 항목 ${r.items}개, 설계서 ${r.versions.length ? r.versions.join(', ') : '그대로'}`,
    );
    return 0;
  } catch (e) {
    return fail([`읽지 못했다: ${(e as Error).message}`], false);
  }
}
