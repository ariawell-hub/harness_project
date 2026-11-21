// DB 금지 규칙 가운데 "도구의 하위 명령"을 인자 배열의 자리로 판정한다(R13, 설정 guard.dbCommands).
// 인자를 공백으로 이은 글에 정규식을 돌리면 인자의 경계가 사라져, 공백이 든 값(`--config "a b.ts"`)을 가를 수 없다.
// 정규식을 쓰지 않으므로 역추적이 없고, 규칙마다 인자 배열을 한 번만 지나간다.
import type { DbCommandRule } from '../lib/config.ts';

export type { DbCommandRule } from '../lib/config.ts';

const EXEC_EXT = /\.(exe|cmd|bat|com)$/;

/** 인자가 도구 자리인가: 경로 조각 가운데 하나가 `tool`이거나 `tool@<버전>`이다. 플래그는 도구 자리가 아니다 */
function isToolArg(lower: string, tool: string): boolean {
  if (lower.startsWith('-')) return false;
  if (!lower.includes(tool)) return false;
  for (const seg of lower.split(/[\\/]/)) {
    const name = seg.replace(EXEC_EXT, '');
    if (name === tool || name.startsWith(`${tool}@`)) return true;
  }
  return false;
}

/**
 * 규칙 하나로 인자 배열을 왼쪽에서 오른쪽으로 한 번 지나간다. 걸린 금지 항목을 돌려준다.
 *
 * 도구 자리 뒤를 걷는 규칙:
 * - `--` 다음 인자가 하위 명령이다. 거기서 비교하고 걷기를 끝낸다.
 * - `-`로 시작하는 인자는 플래그다.
 * - 그 밖의 인자는 금지 목록과 비교한다. 걸리지 않았을 때, 바로 앞이 플래그였으면 그 값일 수 있으므로 계속 걷고,
 *   아니면 그 인자가 하위 명령이므로 걷기를 끝낸다(허용된 하위 명령 뒤의 인자는 보지 않는다).
 *
 * 걷는 중에 다음 도구 자리를 만나면 그 인자를 위 규칙대로 처리한 뒤 거기서 새로 걷는다. 도구 자리마다 따로
 * 걸은 것과 결과가 같다: 앞선 걷기에서 그 인자는 플래그가 아니므로, 앞이 플래그가 아니면 앞선 걷기는 거기서
 * 끝나고, 앞이 플래그면 값으로 보고 "플래그 뒤가 아님" 상태로 다음 인자에 가는데 이는 새 걷기의 상태와 같다.
 */
function scan(argv: readonly string[], tool: string, forbidden: string[][]): string | null {
  const n = argv.length;
  let walking = false;
  let afterFlag = false;
  /** `--` 바로 다음 인자인가 */
  let afterDashes = false;
  for (let i = 0; i < n; i++) {
    const a = argv[i].toLowerCase();
    if (walking) {
      if (!afterDashes && a === '--') {
        afterDashes = true;
        continue;
      }
      if (!afterDashes && a.startsWith('-')) {
        afterFlag = true;
        continue;
      }
      const hit = forbiddenAt(argv, i, a, forbidden);
      if (hit) return hit;
      if (afterDashes || !afterFlag) walking = false;
      afterFlag = false;
      afterDashes = false;
    }
    if (isToolArg(a, tool)) {
      walking = true;
      afterFlag = false;
      afterDashes = false;
    }
  }
  return null;
}

/** 자리 i부터의 인자들이 금지 항목의 낱말 열과 차례로 같은가. 뒤의 인자는 필요한 만큼만, 한 번씩만 읽는다 */
function forbiddenAt(
  argv: readonly string[],
  i: number,
  first: string,
  forbidden: string[][],
): string | null {
  const ahead: string[] = [first];
  for (const words of forbidden) {
    if (words[0] !== first) continue;
    let same = true;
    for (let j = 1; j < words.length; j++) {
      if (i + j >= argv.length) {
        same = false;
        break;
      }
      if (ahead.length <= j) ahead.push(argv[i + j].toLowerCase());
      if (ahead[j] !== words[j]) {
        same = false;
        break;
      }
    }
    if (same) return words.join(' ');
  }
  return null;
}

/** 금지 호출이면 걸린 도구와 하위 명령을, 아니면 null을 돌려준다 */
export function matchDbCommand(
  argv: readonly string[],
  rules: readonly DbCommandRule[],
): { tool: string; sub: string } | null {
  for (const rule of rules) {
    const tool = rule.tool.trim().toLowerCase();
    const forbidden = rule.forbidden
      .map((f) => f.toLowerCase().split(/\s+/).filter(Boolean))
      .filter((w) => w.length > 0);
    if (!tool || forbidden.length === 0) continue;
    const sub = scan(argv, tool, forbidden);
    if (sub) return { tool, sub };
  }
  return null;
}
