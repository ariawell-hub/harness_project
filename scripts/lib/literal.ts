// 남이 정한 글자(세션의 글, PR의 파일 이름)를 GitHub 댓글·요약에 글자 그대로 넣는다(14.6절).
// 코드 스팬과 펜스 코드 블록 안의 글자는 멘션·`#번호`·이모지·Markdown·HTML로 읽히지 않는다.
// 문자 참조(`&#64;`)로 바꾸는 것으로는 멘션과 Issue 참조가 막히지 않는다(GitHub 렌더러로 확인, 계획 20261122-session-text-literal).

/** 글 안의 가장 긴 백틱 줄의 길이 */
function longestTicks(s: string): number {
  // 묶음을 하나씩 본다. 배열을 함수 인자로 펼치면 묶음이 아주 많은 글에서 호출 인자 한도를 넘는다
  let max = 0;
  for (const m of s.matchAll(/`+/g)) max = Math.max(max, m[0].length);
  return max;
}

/**
 * 한 줄 코드 스팬. 줄 나눔 글자의 묶음은 공백 하나로 바꾼다. 비었거나 공백뿐이면 ''.
 * 구분 백틱은 글 안의 가장 긴 백틱 줄보다 하나 길어서 글이 스팬을 닫지 못한다
 */
export function literalSpan(s: string): string {
  const t = s.replace(/[\r\n\u2028\u2029]+/g, ' ');
  if (!t.trim()) return '';
  const fence = '`'.repeat(longestTicks(t) + 1);
  return `${fence} ${t} ${fence}`;
}

/**
 * 펜스 코드 블록(여는 줄에 `text`). `\r\n`과 홀로 있는 `\r`은 `\n`으로 바꾸고 앞뒤 빈 줄을 뗀다. 비었거나 공백뿐이면 ''.
 * 닫는 펜스는 여는 펜스와 같은 글자이고 길이가 같거나 길어야 한다. 펜스(백틱 셋 이상)를 글 안의 가장 긴 백틱 줄보다
 * 하나 길게 해서 글의 어느 줄도 블록을 닫지 못한다
 */
export function literalBlock(s: string): string {
  const t = s.replace(/\r\n?/g, '\n').replace(/^\n+|\n+$/g, '');
  if (!t.trim()) return '';
  const fence = '`'.repeat(Math.max(3, longestTicks(t) + 1));
  return `${fence}text\n${t}\n${fence}`;
}
