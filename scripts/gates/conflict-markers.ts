// 충돌 표식 검사 (R7, 절차서 5절): 작업 트리에 남은 병합 충돌 표식 줄을 찾는다.
// 대상은 git이 추적하는 파일과 무시되지 않는 새 파일이다. 커밋 여부와 무관하게 작업 트리의 내용을 본다.
// 주의: 이 파일 자신이 검사에 걸리지 않도록 표식 문자열을 반복으로 조립한다.
import { gitTry } from '../lib/git.ts';
import type { Problem } from '../lib/util.ts';

const START = '<'.repeat(7);
const END = '>'.repeat(7);
const DOC = 'docs/harness/workflow.md 5절';

/** 표식 바로 뒤가 공백이거나 줄 끝(CR 하나 허용)인 줄만 충돌 표식 줄이다. 구분 줄(`=` 일곱 개)은 세지 않는다 */
const MARKER_LINE = new RegExp(`^(?:${START}|${END})(?: |\\r?$)`);
/** `git grep -n -z`의 한 줄: 경로 NUL 줄 번호 NUL 줄 내용 LF */
const RECORD = /([^\0]+)\0(\d+)\0([^\n]*)\n/y;

function failed(why: string): Problem[] {
  return [
    {
      rule: 'R7 충돌 표식 검사 실패',
      what: `충돌 표식을 검사하지 못했다(git grep ${why})`,
      how: '이 폴더에서 `git status`가 도는지, 읽을 수 없는 파일이나 폴더가 없는지 확인하고 고친 뒤 다시 실행하라',
      doc: DOC,
    },
  ];
}

/** 작업 트리에 남은 병합 충돌 표식 줄을 찾는다. 파일마다 한 건, 경로 순 */
export function conflictMarkers(root: string): Problem[] {
  // -G·--no-color·--no-column: 사용자의 git 설정(grep.patternType, color.grep, grep.column)이
  // 패턴 해석과 출력 형식을 바꾸지 못하게 한다
  const r = gitTry(
    [
      'grep',
      '-n',
      '-I',
      '-z',
      '-G',
      '--no-color',
      '--no-column',
      '--no-recurse-submodules',
      '--untracked',
      '-e',
      `^${START}`,
      '-e',
      `^${END}`,
      '--',
      '.',
    ],
    root,
  );
  // 읽을 수 없는 파일·폴더가 있으면 git grep은 그것을 건너뛰고 표준 오류에만 적는다(종료 코드는 그대로다)
  if (r.stderr.trim() !== '') return failed('오류 출력');
  if (r.code === 1 && r.stdout === '') return [];
  if (r.code !== 0) return failed(`종료 코드 ${r.code}`);

  const byFile = new Map<string, number[]>();
  RECORD.lastIndex = 0;
  let at = 0;
  while (at < r.stdout.length) {
    RECORD.lastIndex = at;
    const m = RECORD.exec(r.stdout);
    if (!m) return failed('출력 해석 실패');
    at = RECORD.lastIndex;
    if (!MARKER_LINE.test(m[3])) continue;
    const lines = byFile.get(m[1]) ?? [];
    lines.push(Number(m[2]));
    byFile.set(m[1], lines);
  }

  return [...byFile.keys()].sort().map((file) => {
    const lines = byFile.get(file)!;
    return {
      rule: 'R7 충돌 표식',
      what: `${file}:${Math.min(...lines)}에 병합 충돌 표식이 남아 있다(표식 ${lines.length}줄)`,
      how: '충돌 블록을 풀고 표식 줄을 지워라. 표식 모양의 줄이 꼭 필요한 파일이면 줄 머리에 오지 않게 써라',
      doc: DOC,
    };
  });
}
