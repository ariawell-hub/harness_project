// check-adr.ts 테스트: 후보의 평가나 결정이 빠진 ADR을 통과시키지 않는다.
//   node --test lab/actions-cost/test/check-adr.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { checkAdr, REQUIRED_IDS } from '../check-adr.ts';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-adr.ts');

const TABLE_HEAD =
  '| ID | 수단 | 예상 절감 | 잃는 보장 | 바꿔야 하는 것 | 되돌리는 방법 | 확인 상태 |';
const TABLE_RULE = '| --- | --- | --- | --- | --- | --- | --- |';
const COLUMNS = ['수단', '예상 절감', '잃는 보장', '바꿔야 하는 것', '되돌리는 방법', '확인 상태'];

/** 후보표의 한 행. 칸은 차례로 수단, 예상 절감, 잃는 보장, 바꿔야 하는 것, 되돌리는 방법, 확인 상태 */
function row(id: string, cells: Partial<Record<number, string>> = {}): string {
  const base = [
    `${id}로 부르는 절감 수단`,
    '기준선 319분 ÷ PR 40개 = 8.0분',
    '없음',
    '스크립트: 훅이 통과 기록을 확인하게 한다',
    '훅의 확인을 끄고 같은 기간을 다시 잰다',
    '확인함(외부 사실 없음)',
  ];
  return `| ${[id, ...base.map((c, i) => cells[i] ?? c)].join(' | ')} |`;
}

interface Bundle {
  name: string;
  ids: string;
  /** [단가, 분] */
  lines: [string, string][];
  per?: string;
  month?: string;
  within?: string;
  /** 모자라는 폭. null이면 줄을 두지 않는다 */
  short?: string | null;
  assume?: string;
  lost?: string;
}

/** 줄들의 원값($0.00001 단위의 정수) */
function raw(lines: [string, string][]): number {
  return lines.reduce(
    (sum, [rate, minutes]) =>
      sum + Math.round(Number(rate) * 10000) * Math.round(Number(minutes) * 10),
    0,
  );
}
const usd = (units: number, digits: number) => `$${(units / 100000).toFixed(digits)}`;

/** 묶음의 줄. 금액과 판정은 주지 않으면 원값에서 계산한다 */
function bundle(b: Bundle): string[] {
  const r = raw(b.lines);
  const month = r * 100;
  const over = month > 18 * 100000;
  const short =
    b.short === undefined
      ? over
        ? usd(Math.ceil((month - 1800000) / 1000) * 1000, 2)
        : null
      : b.short;
  return [
    `### 묶음 ${b.name}`,
    '',
    `- 수단: ${b.ids}`,
    `- 가정: ${b.assume ?? 'PR당 head 수와 job의 분은 기준선에서 가져왔다'}`,
    ...b.lines.map(([rate, minutes]) => `- PR당 청구 분(분당 $${rate}): ${minutes}`),
    `- PR당 금액: ${b.per ?? usd(Math.ceil(r / 100) * 100, 3)}`,
    `- 월 금액(PR 100개): ${b.month ?? usd(Math.ceil(month / 1000) * 1000, 2)}`,
    `- 예산 안인가: ${b.within ?? (over ? '아니오' : '예')}`,
    ...(short === null ? [] : [`- 모자라는 폭: ${short}`]),
    `- 잃는 보장: ${b.lost ?? '없음'}`,
    '',
  ];
}

const GA: Bundle = {
  name: '가',
  ids: 'A1, A4, B1',
  lines: [
    ['0.006', '20.0'],
    ['0.002', '10.0'],
  ],
};
const NA: Bundle = { name: '나', ids: 'C1, C2', lines: [['0.006', '40.0']] };

const PROPOSED = [
  '- 추천 묶음: 가',
  '- 순서: A1 → A4 → B1',
  '- 이유: 훅만 바꾸는 수단을 먼저 넣고 다시 잰 뒤에 워크플로를 바꾼다.',
];
const ADOPTED = ['- 고른 묶음: 가', '- 순서: A1 → A4 → B1', '- 결정한 사람: 제작자(2026-11-23)'];

interface Options {
  status?: string;
  rows?: string[];
  bundles?: Bundle[];
  decision?: string[];
}

/** 모든 조건을 채운 ADR 글 */
function goodAdr(o: Options = {}): string {
  const status = o.status ?? '제안';
  return [
    '---',
    'status: active',
    'related_code: []',
    'review_cycle: on-change',
    '---',
    '',
    '# ADR-0008: 비공개 리포의 Actions 비용 — 예산과 절감 수단',
    '',
    '- 날짜: 2026-11-22',
    `- 상태: ${status} (제작자가 묶음을 고르면 채택으로 바꾼다)`,
    '- 관련: 설계서 10.4절, 18절',
    '',
    '## 배경',
    '',
    '기준선은 [Actions 비용 문서](../harness/actions-cost.md)에 있다. PR 하나당 100.7분이 청구됐고 예산은 PR 하나당 30분이다.',
    '비용은 check가 39.4%, 판정 워크플로 둘이 40.3%, 게이트가 19.6%를 차지한다. 올림으로 붙은 몫이 40.8%다.',
    '',
    '## 후보표',
    '',
    TABLE_HEAD,
    TABLE_RULE,
    ...(o.rows ?? REQUIRED_IDS.map((id) => row(id))),
    '',
    '## 묶음',
    '',
    ...(o.bundles ?? [GA, NA]).flatMap(bundle),
    '## 결정',
    '',
    '고른 수단은 수단마다 별도 Issue로 구현한다. 보안 설계와 워크플로를 바꾸는 것은 위험도 높음이다.',
    '',
    ...(o.decision ?? (status === '채택' ? ADOPTED : PROPOSED)),
    '',
    '## 되돌리는 조건',
    '',
    '수단을 넣고 다시 쟀을 때 PR 하나당 금액이 줄지 않았거나 잃는 보장이 예상보다 크면 그 수단을 되돌린다.',
    '',
  ].join('\n');
}

function fails(problems: string[], re: RegExp): void {
  assert.ok(problems.length > 0, '어긋난 점이 없다(통과했다)');
  assert.ok(
    problems.some((p) => re.test(p)),
    `어긋난 점에 ${re}에 맞는 것이 없다:\n${problems.join('\n')}`,
  );
}
function swap(text: string, from: string, to: string): string {
  assert.equal(text.split(from).length, 2, `바꿀 자리가 하나가 아니다: ${from}`);
  return text.replace(from, () => to);
}
const rowsWith = (id: string, cells: Partial<Record<number, string>>) =>
  REQUIRED_IDS.map((x) => (x === id ? row(x, cells) : row(x)));
/** 절 하나의 제목과 본문 */
function sectionOf(text: string, title: string): string {
  const from = text.indexOf(`## ${title}\n`);
  assert.ok(from >= 0);
  const next = text.indexOf('\n## ', from + 1);
  return next < 0 ? text.slice(from) : text.slice(from, next + 1);
}

test('REQUIRED_IDS: 계획의 후보 18개다', () => {
  assert.deepEqual(
    [...REQUIRED_IDS],
    'A1 A2 A3 A4 A5 A6 B1 B2 B3 B4 C1 C2 C3 D1 D2 D3 E1 E2'.split(' '),
  );
});

test('checkAdr: 모든 조건을 채운 ADR은 통과한다(제안, 채택, ID 목록을 고른 채택)', () => {
  assert.deepEqual(checkAdr(goodAdr()), []);
  assert.deepEqual(checkAdr(goodAdr({ status: '채택' })), []);
  const ids = ['- 고른 묶음: B1, A5', '- 순서: A5 → B1', '- 결정한 사람: 제작자(2026-11-23)'];
  assert.deepEqual(checkAdr(goodAdr({ status: '채택', decision: ids })), []);
  // 조사하면서 더한 수단
  assert.deepEqual(
    checkAdr(goodAdr({ rows: [...REQUIRED_IDS.map((id) => row(id)), row('F1')] })),
    [],
  );
});

test('checkAdr: 빈 글과 제목만 남긴 글은 실패한다', () => {
  fails(checkAdr(''), /절: "## 배경"이 없다/);
  fails(checkAdr(''), /머리.*상태/);
  const heads = goodAdr()
    .split('\n')
    .filter((l) => /^(#|- 상태:)/.test(l))
    .join('\n');
  fails(checkAdr(heads), /후보표/);
  fails(checkAdr(heads), /배경.*100자/);
  fails(checkAdr(heads), /되돌리는 조건/);
});

test('checkAdr: 머리의 상태 줄은 하나이고 제안이나 채택으로 시작한다', () => {
  const doc = goodAdr();
  const line = '- 상태: 제안 (제작자가 묶음을 고르면 채택으로 바꾼다)';
  fails(checkAdr(swap(doc, `${line}\n`, '')), /머리.*상태.*없다/);
  fails(checkAdr(swap(doc, line, `${line}\n- 상태: 채택`)), /머리.*상태.*2번/);
  fails(checkAdr(swap(doc, line, '- 상태: 잠정')), /머리.*제안.*채택/);
  fails(checkAdr(swap(doc, line, '- 상태:')), /머리.*제안.*채택/);
});

for (const title of ['배경', '후보표', '묶음', '결정', '되돌리는 조건'])
  test(`checkAdr: "## ${title}" 절이 없으면 실패한다`, () => {
    const doc = goodAdr();
    fails(checkAdr(swap(doc, sectionOf(doc, title), '')), new RegExp(`절: "## ${title}"이 없다`));
  });

test('checkAdr: 절은 한 번씩, 정한 순서로 있다', () => {
  const doc = goodAdr();
  fails(checkAdr(`${doc}\n## 배경\n\n한 번 더 적은 절이다.\n`), /절: "## 배경"이 2번/);
  const background = sectionOf(doc, '배경');
  const moved = `${swap(doc, background, '')}\n${background}`;
  fails(checkAdr(moved), /절: 순서/);
});

test('checkAdr 배경: 본문, 기준선 문서로 가는 링크, 예산이 있다', () => {
  const doc = goodAdr();
  fails(checkAdr(swap(doc, sectionOf(doc, '배경'), '## 배경\n\n')), /배경.*100자/);
  fails(
    checkAdr(
      swap(
        doc,
        '[Actions 비용 문서](../harness/actions-cost.md)',
        'Actions 비용 문서 actions-cost.md',
      ),
    ),
    /배경.*링크/,
  );
  fails(checkAdr(swap(doc, 'PR 하나당 30분이다', 'PR 하나당 서른 분이다')), /배경.*30분/);
});

test('checkAdr 배경: 기준선 링크의 주소는 ADR 폴더에서 본 기준선 문서 그대로다', () => {
  const doc = goodAdr();
  const link = '[Actions 비용 문서](../harness/actions-cost.md)';
  // 파일 이름만 같고 닿지 않는 주소, 같은 문서를 다르게 적은 주소
  for (const target of [
    '../missing/actions-cost.md',
    'actions-cost.md',
    '../actions-cost.md',
    '../../docs/harness/actions-cost.md',
    './../harness/actions-cost.md',
    '../harness/./actions-cost.md',
    '/docs/harness/actions-cost.md',
    'https://example.com/docs/harness/actions-cost.md',
    '../harness/actions-cost.md?plain=1',
    '../harness/actions-cost.md/',
  ])
    fails(checkAdr(swap(doc, link, `[Actions 비용 문서](${target})`)), /배경.*링크/);
  // 글이 없는 링크는 화면에 보이지 않는다
  fails(checkAdr(swap(doc, link, '[](../harness/actions-cost.md)')), /배경.*링크/);
  fails(checkAdr(swap(doc, link, '[ ](../harness/actions-cost.md)')), /배경.*링크/);
  // 바른 주소 뒤의 절 이름은 받는다
  assert.deepEqual(
    checkAdr(swap(doc, link, '[Actions 비용 문서](../harness/actions-cost.md#기준선)')),
    [],
  );
  // 틀린 링크가 있어도 바른 링크가 하나 있으면 된다
  assert.deepEqual(
    checkAdr(swap(doc, link, `${link}와 [다른 문서](../missing/actions-cost.md)`)),
    [],
  );
});

test('checkAdr 배경: 링크의 글에 코드나 짝이 맞는 대괄호가 있어도 화면에서 링크이면 센다', () => {
  const doc = goodAdr();
  const link = '[Actions 비용 문서](../harness/actions-cost.md)';
  for (const shown of [
    '[Actions 비용 문서 `actions-cost.md`](../harness/actions-cost.md)',
    '[`actions-cost.md`](../harness/actions-cost.md)',
    '[Actions 비용 문서 `a[0]`](../harness/actions-cost.md)',
    '[`[예시](x.md)` 말고 Actions 비용 문서](../harness/actions-cost.md)',
    '[Actions 비용 문서 [기준선]](../harness/actions-cost.md)',
  ])
    assert.deepEqual(checkAdr(swap(doc, link, shown)), [], shown);
});

test('checkAdr 배경: 화면에서 링크가 아닌 글은 기준선 링크로 세지 않는다', () => {
  const doc = goodAdr();
  const link = '[Actions 비용 문서](../harness/actions-cost.md)';
  for (const shown of [
    // 코드로 적은 링크 예시
    '`[Actions 비용 문서](../harness/actions-cost.md)`',
    '[Actions 비용 문서 `actions-cost.md](../harness/actions-cost.md)` 참고',
    // 글에 코드가 있어도 주소가 틀리면 세지 않는다
    '[Actions 비용 문서 `actions-cost.md`](../missing/actions-cost.md)',
    // 글 안에 링크가 있으면 바깥은 링크가 아니다
    '[Actions [비용](../missing/x.md) 문서](../harness/actions-cost.md)',
    // 여는 대괄호가 없다
    'Actions 비용 문서](../harness/actions-cost.md)',
    'Actions] 비용 문서](../harness/actions-cost.md)',
    // 여는 대괄호가 다른 목록 항목에 있다
    '[Actions 비용\n- 문서](../harness/actions-cost.md)',
    // 여는 대괄호가 다른 문단에 있다
    '[Actions 비용\n\n문서](../harness/actions-cost.md)',
    // 글에 보이는 글자가 없다
    '[**](../harness/actions-cost.md)',
    '[&nbsp;](../harness/actions-cost.md)',
    '[&#8203;](../harness/actions-cost.md)',
    '[...](../harness/actions-cost.md)',
    // 화면에 보이지 않는 채움 글자(U+3164), 코드 구간을 가리는 데 쓰는 글자(U+E000)
    '[\u3164](../harness/actions-cost.md)',
    '[\uE000](../harness/actions-cost.md)',
  ])
    fails(checkAdr(swap(doc, link, shown)), /배경.*링크/);
});

test('checkAdr 배경: 기준선 링크는 한 줄에 적는다(줄을 넘는 글은 형식 오류다)', () => {
  const doc = goodAdr();
  const link = '[Actions 비용 문서](../harness/actions-cost.md)';
  // 줄을 넘는 글이 링크인지는 그 사이의 줄이 블록을 가르는지에 달렸다. 가려 읽지 않고 받지 않는다
  for (const shown of [
    '[Actions 비용\n문서](../harness/actions-cost.md)',
    '[Actions 비용 `actions-cost.md`\n문서](../harness/actions-cost.md)',
    '[Actions 비용\n_ _ _\n문서](../harness/actions-cost.md)',
    '[Actions 비용\n***\n문서](../harness/actions-cost.md)',
    '[Actions 비용\n===\n문서](../harness/actions-cost.md)',
    '[Actions 비용\n### 제목\n문서](../harness/actions-cost.md)',
    '[Actions 비용\n\n문서](../harness/actions-cost.md)',
    '[Actions 비용\n- 문서](../harness/actions-cost.md)',
  ])
    fails(checkAdr(swap(doc, link, shown)), /배경 형식\(\d+째 줄\).*기준선 링크.*한 줄/);
  // 바른 링크가 따로 있어도 줄을 넘는 기준선 링크는 형식 오류다
  fails(
    checkAdr(swap(doc, link, `${link}와 [다른\n글](../harness/actions-cost.md)`)),
    /배경 형식\(\d+째 줄\).*기준선 링크.*한 줄/,
  );
  // 기준선 문서가 아닌 링크의 글은 줄을 넘어도 이 검사가 보지 않는다
  assert.deepEqual(checkAdr(swap(doc, link, `${link}와 [다른\n글](../other/x.md)`)), []);
});

test('checkAdr 후보표: 표가 하나이고 머리 줄과 구분 줄이 맞다', () => {
  const doc = goodAdr();
  const second = `${TABLE_HEAD}\n${TABLE_RULE}\n${row('G1')}`;
  fails(checkAdr(swap(doc, '\n## 묶음', `\n${second}\n\n## 묶음`)), /후보표: 표가 2개/);
  fails(
    checkAdr(swap(doc, sectionOf(doc, '후보표'), '## 후보표\n\n표를 아직 쓰지 않았다.\n\n')),
    /후보표: 표가 0개/,
  );
  fails(checkAdr(swap(doc, TABLE_HEAD, TABLE_HEAD.replace('| 확인 상태 ', ''))), /후보표.*머리 줄/);
  fails(checkAdr(swap(doc, TABLE_RULE, '| --- |')), /후보표.*구분 줄/);
  // 표에 붙여 쓴 줄은 화면에서 표의 행이 된다
  const loose =
    'Z1 | 수단 | 1분 | 없음 | 설정: 값을 바꾼다 | 값을 되돌린다 | 확인함(외부 사실 없음)';
  fails(checkAdr(swap(doc, row('E2'), `${row('E2')}\n${loose}`)), /후보표/);
});

test('checkAdr 후보표: 반드시 다룰 후보가 모두 있고 ID가 겹치지 않으며 꼴이 맞다', () => {
  for (const id of ['A4', 'E2', 'C3'])
    fails(
      checkAdr(goodAdr({ rows: REQUIRED_IDS.filter((x) => x !== id).map((x) => row(x)) })),
      new RegExp(`후보표.*${id}.*없다`),
    );
  fails(
    checkAdr(goodAdr({ rows: [...REQUIRED_IDS.map((x) => row(x)), row('A1')] })),
    /후보표.*A1.*2번/,
  );
  for (const bad of ['a1', 'AB1', 'A', '1A', 'A1b'])
    fails(
      checkAdr(goodAdr({ rows: [...REQUIRED_IDS.map((x) => row(x)), row(bad)] })),
      /후보표.*대문자 하나와 수/,
    );
});

test('checkAdr 후보표: ID만 남기고 칸을 비운 행은 실패한다', () => {
  const doc = goodAdr();
  fails(checkAdr(swap(doc, row('A4'), '| A4 | | | | | | |')), /후보표 A4 행.*수단.*비었다/);
  fails(checkAdr(swap(doc, row('A4'), '| A4 | | | | | | |')), /후보표 A4 행.*확인 상태.*비었다/);
  fails(checkAdr(swap(doc, row('A4'), '| A4 | 수단 이름 |')), /후보표 A4 행.*칸이 2개/);
});

COLUMNS.forEach((name, i) => {
  test(`checkAdr 후보표: "${name}" 칸이 자리만 채운 글이면 실패한다`, () => {
    for (const filler of ['-', '—', '?', 'TBD', '미정'])
      fails(
        checkAdr(goodAdr({ rows: rowsWith('B2', { [i]: filler }) })),
        new RegExp(`후보표 B2 행.*${name}`),
      );
    // "없음"만 적은 칸은 "잃는 보장"에서만 된다
    const none = checkAdr(goodAdr({ rows: rowsWith('B2', { [i]: '없음' }) }));
    if (name === '잃는 보장') assert.deepEqual(none, []);
    else fails(none, new RegExp(`후보표 B2 행.*${name}`));
  });
});

test('checkAdr 후보표: 수단은 4자 이상이다', () => {
  fails(checkAdr(goodAdr({ rows: rowsWith('D1', { 0: '캐 시' }) })), /후보표 D1 행.*수단.*4자/);
});

test('checkAdr 후보표: 예상 절감에는 수와 단위가 있거나 "재 봐야 안다"와 이유가 있다', () => {
  const check = (v: string) => checkAdr(goodAdr({ rows: rowsWith('D1', { 1: v }) }));
  fails(check('꽤 많이 줄어든다'), /후보표 D1 행.*예상 절감/);
  fails(check('40 정도 줄어든다'), /후보표 D1 행.*예상 절감/);
  fails(check('재 봐야 안다'), /후보표 D1 행.*예상 절감.*10자/);
  fails(check('재 봐야 안다: 모른다'), /후보표 D1 행.*예상 절감.*10자/);
  assert.deepEqual(check('1968분 × $0.004 = $7.87'), []);
  assert.deepEqual(check('전체의 16.7%'), []);
  assert.deepEqual(check('PR 하나당 8.0분'), []);
  assert.deepEqual(
    check('재 봐야 안다: 보존 기록에 check의 결론이 없어 실패한 head를 셀 수 없다'),
    [],
  );
});

test('checkAdr 후보표: 잃는 보장은 "없음"으로 시작하거나 절·규칙 번호가 있다', () => {
  const check = (v: string) => checkAdr(goodAdr({ rows: rowsWith('C2', { 2: v }) }));
  fails(check('격리가 조금 약해진다'), /후보표 C2 행.*잃는 보장/);
  assert.deepEqual(check('없음. 같은 러너에서 돈다'), []);
  assert.deepEqual(check('10.4절의 job 분리가 약해진다'), []);
  assert.deepEqual(check('5절의 보장 수준이 바뀐다'), []);
  assert.deepEqual(check('R7의 재실행이 중간 head에서 없어진다'), []);
  assert.deepEqual(check('E3가 말하는 일회용 러너가 아니게 된다'), []);
});

test('checkAdr 후보표: 바꿔야 하는 것에는 정한 낱말이 있고, 되돌리는 방법에는 글이 있다', () => {
  fails(
    checkAdr(goodAdr({ rows: rowsWith('A2', { 3: '여러 곳을 조금씩 고쳐야 한다' }) })),
    /후보표 A2 행.*바꿔야 하는 것/,
  );
  fails(
    checkAdr(goodAdr({ rows: rowsWith('A2', { 3: '워크플로' }) })),
    /후보표 A2 행.*바꿔야 하는 것.*10자/,
  );
  for (const word of ['워크플로', '설계서', '훅', '스크립트', '설정', '절차서'])
    assert.deepEqual(
      checkAdr(goodAdr({ rows: rowsWith('A2', { 3: `${word}: 무엇을 어떻게 바꾸는지 적는다` }) })),
      [],
    );
  fails(
    checkAdr(goodAdr({ rows: rowsWith('A2', { 4: '되돌린다' }) })),
    /후보표 A2 행.*되돌리는 방법.*10자/,
  );
});

test('checkAdr 후보표: 확인 상태에는 출처와 날짜, 또는 확인하지 못한 것이 있다', () => {
  const check = (v: string) => checkAdr(goodAdr({ rows: rowsWith('B1', { 5: v }) }));
  fails(check('확인함'), /후보표 B1 행.*확인 상태/);
  fails(check('확인함()'), /후보표 B1 행.*확인 상태/);
  fails(check('확인함(공식 문서, 2026-11-22)'), /후보표 B1 행.*확인 상태.*https/);
  fails(check('확인함(https://docs.github.com/en/billing)'), /후보표 B1 행.*확인 상태.*날짜/);
  fails(
    check('확인함(https://docs.github.com/en/billing, 2026-02-30)'),
    /후보표 B1 행.*확인 상태.*날짜/,
  );
  fails(check('확인 못 함'), /후보표 B1 행.*확인 상태.*10자/);
  fails(check('확인했다고 들었다'), /후보표 B1 행.*확인 상태/);
  assert.deepEqual(
    check('확인함(https://docs.github.com/en/billing, 2026-11-22). 분당 $0.002다'),
    [],
  );
  assert.deepEqual(check('확인함(외부 사실 없음)'), []);
  assert.deepEqual(check('확인 못 함: 개인 계정에서 쓸 수 있는지 공개 문서에 없다'), []);
});

test('checkAdr 묶음: 둘 이상이고 이름이 겹치지 않는다', () => {
  fails(checkAdr(goodAdr({ bundles: [GA] })), /묶음.*둘 이상/);
  fails(checkAdr(goodAdr({ bundles: [] })), /묶음.*둘 이상/);
  fails(checkAdr(goodAdr({ bundles: [GA, { ...NA, name: '가' }] })), /묶음.*이름.*가.*겹친다/);
});

const BUNDLE_LINES = [
  '- 수단:',
  '- 가정:',
  '- PR당 청구 분(분당 $0.006):',
  '- PR당 금액:',
  '- 월 금액(PR 100개):',
  '- 예산 안인가:',
  '- 잃는 보장:',
];
for (const head of BUNDLE_LINES)
  test(`checkAdr 묶음: "${head}" 줄의 값이 비었거나 줄이 없으면 실패한다`, () => {
    const doc = goodAdr();
    const part = sectionOf(doc, '묶음');
    const lines = part.split('\n');
    const at = lines.findIndex((l) => l.startsWith(head));
    assert.ok(at >= 0);
    const name = head.replace(/^- /, '').replace(/[:(].*$/, '');
    const emptied = lines.map((l, i) => (i === at ? head : l)).join('\n');
    fails(checkAdr(swap(doc, part, emptied)), new RegExp(`묶음 가.*${name}`));
    const dropped = lines.filter((_, i) => i !== at).join('\n');
    fails(checkAdr(swap(doc, part, dropped)), new RegExp(`묶음 가.*${name}`));
    const twice = lines.flatMap((l, i) => (i === at ? [l, l] : [l])).join('\n');
    fails(checkAdr(swap(doc, part, twice)), /묶음 가/);
  });

test('checkAdr 묶음: 수단의 ID는 후보표에 있고 겹치지 않는다', () => {
  fails(checkAdr(goodAdr({ bundles: [{ ...GA, ids: 'A1, Z9' }, NA] })), /묶음 가.*Z9.*후보표/);
  fails(checkAdr(goodAdr({ bundles: [{ ...GA, ids: 'A1, A1' }, NA] })), /묶음 가.*A1.*겹친다/);
  fails(checkAdr(goodAdr({ bundles: [{ ...GA, ids: 'A1 A4' }, NA] })), /묶음 가.*수단/);
});

test('checkAdr 묶음: PR당 청구 분 줄의 단가와 분의 꼴', () => {
  const check = (lines: [string, string][], more: Partial<Bundle> = {}) =>
    checkAdr(goodAdr({ bundles: [{ ...GA, lines, ...more }, NA] }));
  // 분은 소수 첫째 자리까지, 단가는 소수 넷째 자리까지
  fails(check([['0.006', '20.05']]), /묶음 가.*분.*소수 첫째/);
  fails(check([['0.00601', '20.0']]), /묶음 가.*단가.*소수 넷째/);
  fails(check([['0', '20.0']]), /묶음 가.*단가.*0보다/);
  fails(check([['0.006', '20분쯤']]), /묶음 가.*분/);
  fails(
    check([
      ['0.006', '10.0'],
      ['0.0060', '5.0'],
    ]),
    /묶음 가.*단가.*겹친다/,
  );
  assert.deepEqual(check([['0.006', '0']], { per: '$0.000', month: '$0.00' }), []);
  assert.deepEqual(check([['0.006', '20']]), []);
});

test('checkAdr 묶음: PR당 금액과 월 금액은 원값을 올림한 값이다', () => {
  const check = (b: Partial<Bundle>) => checkAdr(goodAdr({ bundles: [{ ...GA, ...b }, NA] }));
  // 20.0분 × $0.006 + 10.0분 × $0.002 = $0.14
  fails(check({ per: '$0.120' }), /묶음 가.*PR당 금액/);
  fails(check({ per: '$0.141' }), /묶음 가.*PR당 금액/);
  fails(check({ per: '0.140' }), /묶음 가.*PR당 금액/);
  fails(check({ month: '$14.01' }), /묶음 가.*월 금액/);
  fails(check({ month: '$13.99' }), /묶음 가.*월 금액/);
  // 표시값은 수로 읽어 견준다
  assert.deepEqual(check({ per: '$0.14', month: '$14.000' }), []);
});

test('checkAdr 묶음: 예산 안인지는 분이 아니라 금액으로 판정한다', () => {
  const cheap: Bundle = { ...GA, lines: [['0.003', '40.0']] };
  assert.deepEqual(checkAdr(goodAdr({ bundles: [cheap, NA] })), []);
  // 분당 $0.003으로 40분은 월 $12라 "예"여야 한다
  fails(
    checkAdr(goodAdr({ bundles: [{ ...cheap, within: '아니오', short: '$0.00' }, NA] })),
    /묶음 가.*예산 안인가/,
  );
  // 분당 $0.006으로 40분은 월 $24라 "아니오"여야 한다
  fails(
    checkAdr(goodAdr({ bundles: [GA, { ...NA, within: '예', short: null }] })),
    /묶음 나.*예산 안인가/,
  );
  fails(checkAdr(goodAdr({ bundles: [{ ...GA, within: '그렇다' }, NA] })), /묶음 가.*예산 안인가/);
});

test('checkAdr 묶음: 예산 경계의 올림(원값 $0.1802)', () => {
  const edge: Bundle = {
    ...GA,
    lines: [
      ['0.006', '30.0'],
      ['0.002', '0.1'],
    ],
  };
  const check = (b: Partial<Bundle>) => checkAdr(goodAdr({ bundles: [{ ...edge, ...b }, NA] }));
  assert.deepEqual(check({ per: '$0.181', month: '$18.02', within: '아니오', short: '$0.02' }), []);
  fails(check({ per: '$0.180' }), /묶음 가.*PR당 금액/);
  fails(check({ month: '$18.00' }), /묶음 가.*월 금액/);
  fails(check({ within: '예', short: null }), /묶음 가.*예산 안인가/);
  fails(check({ short: '$0.01' }), /묶음 가.*모자라는 폭/);
  // 30.0분뿐이면 꼭 예산이다
  const exact: Bundle = { ...GA, lines: [['0.006', '30.0']] };
  assert.deepEqual(
    checkAdr(
      goodAdr({ bundles: [{ ...exact, per: '$0.180', month: '$18.00', within: '예' }, NA] }),
    ),
    [],
  );
});

test('checkAdr 묶음: 모자라는 폭은 "아니오"일 때만 있다', () => {
  fails(checkAdr(goodAdr({ bundles: [GA, { ...NA, short: null }] })), /묶음 나.*모자라는 폭.*없다/);
  fails(checkAdr(goodAdr({ bundles: [{ ...GA, short: '$0.00' }, NA] })), /묶음 가.*모자라는 폭/);
  fails(checkAdr(goodAdr({ bundles: [GA, { ...NA, short: '$5.00' }] })), /묶음 나.*모자라는 폭/);
});

test('checkAdr 묶음: 가정에는 글이 있다', () => {
  fails(checkAdr(goodAdr({ bundles: [{ ...GA, assume: '어림했다' }, NA] })), /묶음 가.*가정.*10자/);
});

test('checkAdr 결정: 본문에 "별도 Issue"가 있다', () => {
  const doc = goodAdr();
  fails(
    checkAdr(swap(doc, '수단마다 별도 Issue로 구현한다', '수단마다 따로 구현한다')),
    /결정.*별도 Issue/,
  );
  fails(checkAdr(swap(doc, sectionOf(doc, '결정'), '## 결정\n\n')), /결정.*별도 Issue/);
  fails(checkAdr(swap(doc, sectionOf(doc, '결정'), '## 결정\n\n')), /결정.*추천 묶음/);
});

test('checkAdr 결정(제안): 추천 묶음, 순서, 이유가 있고 고른 묶음은 없다', () => {
  const check = (decision: string[]) => checkAdr(goodAdr({ decision }));
  fails(check(PROPOSED.filter((l) => !l.startsWith('- 추천 묶음:'))), /결정.*추천 묶음.*없다/);
  fails(check(PROPOSED.filter((l) => !l.startsWith('- 순서:'))), /결정.*순서.*없다/);
  fails(check(PROPOSED.filter((l) => !l.startsWith('- 이유:'))), /결정.*이유.*없다/);
  fails(check(['- 추천 묶음: 다', PROPOSED[1], PROPOSED[2]]), /결정.*추천 묶음.*다.*묶음/);
  fails(check([PROPOSED[0], PROPOSED[1], '- 이유: 싸다.']), /결정.*이유.*20자/);
  fails(check([...PROPOSED, '- 고른 묶음: 가']), /결정.*제안.*고른 묶음/);
  fails(check([...PROPOSED, PROPOSED[1]]), /결정.*순서.*2번/);
});

for (const status of ['제안', '채택'])
  test(`checkAdr 결정(${status}): 순서는 고른 수단을 모두 한 번씩 담는다`, () => {
    const base = status === '채택' ? ADOPTED : PROPOSED;
    const check = (order: string) =>
      checkAdr(
        goodAdr({ status, decision: base.map((l) => (l.startsWith('- 순서:') ? order : l)) }),
      );
    assert.deepEqual(check('- 순서: B1 → A1 → A4'), []);
    fails(check('- 순서: A1 → A4 → B1 → C1'), /결정.*순서.*C1/);
    fails(check('- 순서: A1 → A4'), /결정.*순서.*B1/);
    fails(check('- 순서: A1 → A4 → B1 → A1'), /결정.*순서.*A1.*번/);
    fails(check('- 순서:'), /결정.*순서.*비었다/);
    fails(check('- 순서: Z9'), /결정.*순서.*Z9/);
    fails(check('- 순서: A1, A4, B1'), /결정.*순서/);
  });

test('checkAdr 결정(채택): 고른 묶음, 순서, 결정한 사람이 있다', () => {
  const check = (decision: string[]) => checkAdr(goodAdr({ status: '채택', decision }));
  fails(check(ADOPTED.filter((l) => !l.startsWith('- 고른 묶음:'))), /결정.*고른 묶음.*없다/);
  fails(check(ADOPTED.filter((l) => !l.startsWith('- 결정한 사람:'))), /결정.*결정한 사람.*없다/);
  fails(check([ADOPTED[0], ADOPTED[1], '- 결정한 사람: 봇(2026-11-23)']), /결정.*결정한 사람/);
  fails(
    check([ADOPTED[0], ADOPTED[1], '- 결정한 사람: 제작자(2026-13-01)']),
    /결정.*결정한 사람.*날짜/,
  );
  fails(check([ADOPTED[0], ADOPTED[1], '- 결정한 사람: 제작자']), /결정.*결정한 사람/);
  // 묶음 이름도 ID 목록도 아닌 값
  fails(check(['- 고른 묶음: 다', ADOPTED[1], ADOPTED[2]]), /결정.*고른 묶음/);
  fails(check(['- 고른 묶음: A1, Z9', '- 순서: A1 → Z9', ADOPTED[2]]), /결정.*고른 묶음.*Z9/);
  fails(check(['- 고른 묶음: A1, A1', '- 순서: A1', ADOPTED[2]]), /결정.*고른 묶음.*A1/);
  // ID 목록을 골랐으면 순서는 그 목록과 같아야 한다
  fails(check(['- 고른 묶음: B1, A5', '- 순서: A5 → B1 → A1', ADOPTED[2]]), /결정.*순서.*A1/);
  fails(check(['- 고른 묶음: B1, A5', '- 순서: A5', ADOPTED[2]]), /결정.*순서.*B1/);
});

test('checkAdr 되돌리는 조건: 본문이 있다', () => {
  const doc = goodAdr();
  fails(
    checkAdr(swap(doc, sectionOf(doc, '되돌리는 조건'), '## 되돌리는 조건\n\n')),
    /되돌리는 조건.*30자/,
  );
  fails(
    checkAdr(swap(doc, sectionOf(doc, '되돌리는 조건'), '## 되돌리는 조건\n\n되돌린다.\n')),
    /되돌리는 조건.*30자/,
  );
});

test('checkAdr 형식: 문서 검사와 같은 형식만 받는다(주석으로 가린 행, 코드 블록 안의 표)', () => {
  const doc = goodAdr();
  fails(checkAdr(swap(doc, row('A4'), `<!-- ${row('A4')} -->`)), /형식/);
  const table = `${TABLE_HEAD}\n${TABLE_RULE}\n${REQUIRED_IDS.map((id) => row(id)).join('\n')}`;
  fails(checkAdr(swap(doc, table, `\`\`\`text\n${table}\n\`\`\``)), /후보표: 표가 0개/);
  // 한 칸 들여 쓴 둘째 줄, 이름에 강조를 넣은 둘째 줄도 화면에서는 그 줄로 보인다
  fails(checkAdr(swap(doc, PROPOSED[0], `${PROPOSED[0]}\n - 추천 묶음: 나`)), /결정.*추천 묶음/);
  fails(checkAdr(swap(doc, PROPOSED[0], `${PROPOSED[0]}\n- **추천 묶음**: 나`)), /결정.*추천 묶음/);
});

test('check-adr 명령: 통과하면 0, 어긋나면 1이고 어긋난 점을 표준 오류에 낸다', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-adr-'));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  const good = path.join(dir, 'good.md');
  writeFileSync(good, goodAdr());
  const ok = run('--file', good);
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /check-adr: 통과/);
  const bad = path.join(dir, 'bad.md');
  writeFileSync(bad, swap(goodAdr(), `${row('A4')}\n`, ''));
  const failed = run('--file', bad);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /A4/);
  const empty = path.join(dir, 'empty.md');
  writeFileSync(empty, '');
  assert.equal(run('--file', empty).status, 1);
});

test('check-adr 명령: 인자가 틀리거나 파일을 읽지 못하면 1이다', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-adr-'));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  for (const args of [['--nope'], ['--file'], ['extra'], ['--file', 'a', '--file', 'b']]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /사용법/);
  }
  const missing = run('--file', path.join(dir, 'none.md'));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /읽지 못했다/);
  // 절대 경로를 오류 글에 옮기지 않는다
  assert.ok(!missing.stderr.includes(dir));
});

// ---- 화면에는 값으로 보이는데 검사가 읽지 않는 줄을 받지 않는다 ----

test('checkAdr 형식: 표식 구간과 들여 쓴 제목을 받지 않는다', () => {
  const doc = goodAdr();
  // 문서 검사의 표식 구간 안의 줄은 읽히지 않는다. ADR에서는 표식 줄이 형식 오류다
  const hidden = `<!-- actions-cost:begin -->\n${row('Z1')}\n<!-- actions-cost:end -->`;
  fails(checkAdr(swap(doc, '\n## 묶음', `\n${hidden}\n\n## 묶음`)), /형식/);
  fails(checkAdr(`${doc}\n ## 배경\n\n들여 쓴 둘째 절이다.\n`), /형식.*제목/);
});

test('checkAdr: 표는 후보표 절에만 둔다', () => {
  const doc = goodAdr();
  const second = `${TABLE_HEAD}\n${TABLE_RULE}\n${row('G1')}`;
  fails(checkAdr(`${doc}\n${second}\n`), /표: .*되돌리는 조건.*후보표/);
  fails(checkAdr(swap(doc, '## 배경\n', `## 배경\n\n${second}\n`)), /표: .*배경/);
});

test('checkAdr 머리: 모양만 바꾼 둘째 상태 줄과 이어 쓴 줄을 받지 않는다', () => {
  const doc = goodAdr();
  const line = '- 상태: 제안 (제작자가 묶음을 고르면 채택으로 바꾼다)';
  fails(checkAdr(swap(doc, line, `${line}\n- **상태**: 채택`)), /머리.*상태.*더 있다/);
  fails(checkAdr(swap(doc, line, `${line}\n * 상태 : 채택`)), /머리.*상태.*더 있다/);
  fails(checkAdr(swap(doc, line, `${line}\n이었다가 채택`)), /머리.*다음 줄/);
  fails(checkAdr(swap(doc, line, '- 상태: 제안채택')), /머리.*제안.*채택/);
});

test('checkAdr 묶음: 묶음에는 정한 줄만 적는다', () => {
  const doc = goodAdr();
  const per = '- PR당 금액: $0.140';
  // 모양만 바꾼 둘째 줄, 이어 쓴 줄, 풀어 쓴 글
  for (const extra of [
    ' - PR당 금액: $0.010',
    '- **PR당 금액**: $0.010',
    '* PR당 금액: $0.010',
    '아니, $0.010이다',
  ])
    fails(checkAdr(swap(doc, per, `${per}\n${extra}`)), /묶음 가.*정한 줄/);
  fails(checkAdr(swap(doc, per, `${per}\n\n#### 덧붙임`)), /묶음.*제목/);
  fails(
    checkAdr(swap(doc, '- PR당 청구 분(분당 $0.002): 10.0', '- PR당 청구 분(1코어): 10.0')),
    /묶음 가.*정한 줄/,
  );
});

test('checkAdr 묶음: 첫 묶음 앞에는 풀어 쓴 문단만 둔다', () => {
  const doc = goodAdr();
  const intro = (text: string) => swap(doc, '## 묶음\n', `## 묶음\n\n${text}\n`);
  assert.deepEqual(checkAdr(intro('예산에 드는 조합과 가장 싼 조합을 적는다.')), []);
  fails(checkAdr(intro('- 월 금액(PR 100개): $1.00')), /묶음.*첫 묶음 제목 앞/);
  fails(checkAdr(intro('**PR당 금액**: $0.001')), /묶음.*묶음 밖/);
});

test('checkAdr 묶음: 이름이 후보의 ID와 같은 꼴이면 실패한다', () => {
  fails(checkAdr(goodAdr({ bundles: [GA, { ...NA, name: 'A1' }] })), /묶음.*이름.*A1.*꼴/);
});

test('checkAdr 결정: 목록에는 정한 줄만 적고 이어 쓰지 않는다', () => {
  const doc = goodAdr();
  const order = PROPOSED[1];
  fails(checkAdr(swap(doc, order, `${order}\n→ C1`)), /결정.*다음 줄/);
  fails(checkAdr(swap(doc, order, `${order}\n* 순서: C1`)), /결정.*목록/);
  fails(checkAdr(swap(doc, order, `${order}\n> - 순서: C1`)), /결정.*목록/);
  fails(checkAdr(swap(doc, PROPOSED[2], `${PROPOSED[2]}\n\n**순서**: C1 → C2`)), /결정.*"순서:"/);
  fails(
    checkAdr(swap(doc, PROPOSED[2], `${PROPOSED[2]}\n- 결정한 사람: 제작자(2026-11-23)`)),
    /결정.*제안.*결정한 사람/,
  );
});

test('checkAdr 결정(채택): 추천 묶음과 이유는 남겨도 된다', () => {
  const kept = [
    '- 추천 묶음: 나',
    ...ADOPTED,
    '- 이유: 제작자가 보장을 덜 잃는 쪽을 골랐다고 적었다.',
  ];
  assert.deepEqual(checkAdr(goodAdr({ status: '채택', decision: kept })), []);
  fails(
    checkAdr(goodAdr({ status: '채택', decision: ['- 추천 묶음: 다', ...ADOPTED] })),
    /결정.*추천 묶음.*다/,
  );
});
