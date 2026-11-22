// 남이 정한 글자를 GitHub 댓글·요약에 글자 그대로 넣는 함수(14.6절). 계획 20261122-session-text-literal step0.
// 결과를 렌더러의 규칙(CommonMark의 코드 스팬·펜스 코드 블록)으로 읽는 모델로 확인한다.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellCode } from '../ci/gates.ts';
import { literalBlock, literalSpan } from '../lib/literal.ts';
import { codeSpans, fencedBlocks, spanText } from './markdown-model.ts';

const cp = (...n: number[]) => String.fromCodePoint(...n);
const LS = cp(0x2028);
const PS = cp(0x2029);

/** 줄 나눔 글자의 묶음을 공백 하나로 바꾼 글(코드 스팬에 들어가는 글) */
const oneLine = (s: string) => s.split(new RegExp(`[\\r\\n${LS}${PS}]+`)).join(' ');

const SPAN_CASES = [
  '@someone',
  '#1 그리고 owner/repo#2',
  '**굵게** _기울임_ ~~지움~~',
  '[링크](https://example.invalid) <b>x</b> <!-- 주석 -->',
  ':tada: &amp; &#64;someone',
  '백틱 `하나`',
  '``둘`` 과 `하나` 와 ```셋```',
  '`앞과 뒤`',
  '`',
  '````',
  '  앞뒤 공백  ',
  'a|b \\| c',
  '역슬래시로 끝난다\\',
];

test('literalSpan: 글 전체가 코드 스팬 하나이고 안쪽 글자가 원문과 같다', () => {
  for (const s of SPAN_CASES) {
    const got = literalSpan(s);
    assert.equal(spanText(got), s, s);
  }
});

test('literalSpan: 줄 나눔 글자의 묶음은 공백 하나가 된다. 스팬은 한 줄이다', () => {
  const cases = ['a\nb', 'a\r\nb', 'a\rb', `a${LS}b`, `a${PS}b`, `a\n\n${LS}\r\nb`, '`a`\n```\nb'];
  for (const s of cases) {
    const got = literalSpan(s);
    assert.equal(got.split(new RegExp(`[\\r\\n${LS}${PS}]`)).length, 1, JSON.stringify(s));
    assert.equal(spanText(got), oneLine(s), JSON.stringify(s));
  }
});

test('literalSpan: 비었거나 공백뿐이면 빈 글자다', () => {
  for (const s of ['', ' ', '   ', '\n', ` \r\n ${LS} `])
    assert.equal(literalSpan(s), '', JSON.stringify(s));
});

test('cellCode: literalSpan의 결과에서 표의 칸을 가르는 글자만 막은 것이다', () => {
  for (const s of [...SPAN_CASES, 'a\nb', '', '   ', '|', '`|`'])
    assert.equal(cellCode(s), literalSpan(s).replace(/\|/g, '\\|'), JSON.stringify(s));
});

const BLOCK_CASES = [
  '### 질문: 평범한 질문\n\n- A) 하나\n- B) 둘\n- 추천: A',
  '@someone #1 :tada: **굵게** <!-- harness -->',
  '앞\n```\n닫기 시도\n뒤',
  '앞\n````\n닫기 시도\n뒤',
  `앞\n${'`'.repeat(10)}\n뒤`,
  '앞\n   ```\n들여쓴 펜스\n뒤',
  '앞\n```text\n여는 줄 모양\n```\n뒤',
  '앞\n``` \n뒤가 공백\n뒤',
  '앞\n~~~\n물결 펜스\n~~~\n뒤',
  '```',
  '~~~',
  '줄 안의 ```` 백틱 넷과 ``둘``',
  '탭\t과 긴 줄 ' + 'x'.repeat(500),
];

/** 코드 블록에 들어가는 글: 줄 바꿈 글자를 맞추고 앞뒤 빈 줄을 뗀다 */
const blockText = (s: string) =>
  s
    .split(/\r\n|\r/)
    .join('\n')
    .replace(/^\n+|\n+$/g, '');

function assertOneBlock(md: string, want: string, label: string): void {
  const { lines, blocks } = fencedBlocks(md);
  assert.equal(blocks.length, 1, `${label}: 블록은 하나다`);
  assert.equal(blocks[0].open, 0, `${label}: 첫 줄에서 열린다`);
  assert.equal(blocks[0].close, lines.length - 1, `${label}: 마지막 줄에서 닫힌다`);
  assert.equal(blocks[0].text, want, `${label}: 안의 글이 원문과 같다`);
}

test('literalBlock: 펜스 코드 블록 하나이고 글의 어느 줄도 블록을 닫지 못한다', () => {
  for (const s of BLOCK_CASES) assertOneBlock(literalBlock(s), s, JSON.stringify(s.slice(0, 40)));
});

test('literalBlock: 여는 줄은 백틱 셋 이상과 text이고, 글 안의 가장 긴 백틱 줄보다 하나 길다', () => {
  assert.equal(literalBlock('글'), '```text\n글\n```');
  assert.equal(literalBlock('a ``` b'), '````text\na ``` b\n````');
  assert.equal(literalBlock('a ` b'), '```text\na ` b\n```');
  const ten = '`'.repeat(10);
  assert.equal(literalBlock(ten), `${ten}\`text\n${ten}\n${ten}\``);
});

test('literalBlock: 줄 바꿈 글자를 맞추고 앞뒤 빈 줄을 뗀다. 그 밖의 글자는 그대로다', () => {
  const cases = [
    'a\r\nb\r\n```\r\nc',
    'a\rb\r```\rc',
    '\n\na\n\nb\n\n',
    '\r\n\r\na\r\n',
    `줄 구분자 ${LS} 는 그대로 ${PS} 다`,
    '  들여쓴 첫 줄\n끝의 공백  ',
  ];
  for (const s of cases) {
    const got = literalBlock(s);
    assert.ok(!got.includes('\r'), JSON.stringify(s));
    assertOneBlock(got, blockText(s), JSON.stringify(s));
  }
});

test('literalSpan·literalBlock: 백틱 묶음이 아주 많은 글도 예외 없이 감싼다(판정 지적 F7)', () => {
  // 묶음마다 인자 하나를 만들어 함수에 펼치면 호출 인자 한도를 넘는다
  const many = '`a'.repeat(200_000);
  assert.equal(literalSpan(many), `\`\` ${many} \`\``);
  assert.equal(literalBlock(many), `\`\`\`text\n${many}\n\`\`\``);
  const longer = `${many}\n${'`'.repeat(5)}\n끝`;
  assertOneBlock(literalBlock(longer), longer, '묶음 20만 개와 백틱 다섯의 줄');
  assert.equal(literalBlock(longer).split('\n')[0], `${'`'.repeat(6)}text`);
});

test('literalBlock: 비었거나 공백뿐이면 빈 글자다', () => {
  for (const s of ['', ' ', '\n\n', ' \r\n \n'])
    assert.equal(literalBlock(s), '', JSON.stringify(s));
});

test('모델: 코드 스팬과 펜스 블록을 렌더러의 규칙대로 읽는다(모델 자신의 확인)', () => {
  assert.equal(spanText('`a`'), 'a');
  assert.equal(spanText('`` a`b ``'), 'a`b');
  assert.equal(spanText('`a` b `c`'), null, '스팬이 둘이면 전체가 한 스팬이 아니다');
  assert.equal(spanText('`a'), null);
  assert.equal(spanText('a'), null);
  assert.deepEqual(codeSpans('앞 `a` 가운데 `` b`c `` 뒤 `닫히지 않음'), {
    spans: ['a', 'b`c'],
    outside: '앞  가운데  뒤 `닫히지 않음',
  });
  // 글이 블록을 닫으면 블록이 하나가 아니거나 마지막 줄에서 닫히지 않는다
  const broken = fencedBlocks('```text\na\n```\n@someone\n```');
  assert.equal(broken.blocks[0].close, 2);
  assert.equal(broken.blocks.length, 2);
  // 더 짧은 펜스와 다른 글자의 펜스는 닫지 못한다
  assert.equal(fencedBlocks('````\n```\n~~~~\n````').blocks[0].close, 3);
  // 줄 구분자(U+2028)는 줄을 나누지 않는다
  assert.equal(fencedBlocks(`\`\`\`\na${LS}\`\`\`\nb`).blocks[0].close, -1);
});
