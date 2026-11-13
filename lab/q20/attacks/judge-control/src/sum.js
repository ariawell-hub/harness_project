// 대조군(공격 아님): 평범한 변경. 판정 job이 정상 판정을 내는지 본다. 경계 조건 버그가 하나 있다.
export function sum(xs) {
  let s = 0;
  for (let i = 0; i <= xs.length; i++) s += xs[i];
  return s;
}
