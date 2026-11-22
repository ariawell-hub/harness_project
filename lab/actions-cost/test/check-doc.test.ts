// check-doc.ts 테스트: 비었거나 값이 보존 기록과 다른 문서를 통과시키지 않는다.
//   node --test lab/actions-cost/test/check-doc.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  actionsCost,
  formatSaved,
  fromSaved,
  OTHER,
  parseSaved,
  recordCells,
  renderCost,
  type KnownNames,
} from '../../../scripts/metrics/actions-cost.ts';
import { BASELINE_FILE, BUDGET, checkDoc } from '../check-doc.ts';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-doc.ts');

const PERIOD = { since: '2026-11-17', until: '2026-11-20' };
/** 허용 목록이 비어 있어도 `(기타)`는 그대로 나온다. 체크아웃의 워크플로 파일과 무관한 입력이 된다 */
const NO_NAMES: KnownNames = new Map();
const PRICED = ['ubuntu-latest'];
const UNKNOWN = [OTHER];
const SELF_HOSTED = ['self-hosted'];

interface J {
  pr: number | null;
  minutes: number;
  labels?: string[];
  workflow?: string;
  job?: string;
}

/** 작은 가짜 보존 기록. job 하나가 `minutes`분을 꼭 채워 돈다 */
function savedText(jobs: J[], period = PERIOD): string {
  return formatSaved(
    jobs.map((j, i) => ({
      run: i + 1,
      attempt: 1,
      workflow: j.workflow ?? OTHER,
      job: j.job ?? OTHER,
      day: period.since,
      seconds: j.minutes * 60,
      labels: j.labels ?? PRICED,
      pr: j.pr,
      head: j.pr,
      offPr: j.pr === null,
    })),
    period,
  );
}

/** PR 둘, 25분($0.15). PR 하나당 $0.075라 예산 안이다 */
const BASE = savedText([
  { pr: 1, minutes: 10 },
  { pr: 2, minutes: 10 },
  { pr: null, minutes: 5 },
]);

const TABLE_HEAD =
  '| 기간 | 수단 | 청구 분 | PR 하나당 청구 분 | PR 하나당 금액 | PR head 하나당 청구 분 | 30일 환산 금액 | 보존 기록 | 판단 |';
const TABLE_RULE = '| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
const SAVE_COMMAND =
  'node scripts/harness.ts actions-cost --since 2026-11-17 --until 2026-11-20 --save lab/actions-cost/2026-11-17_2026-11-20.jsonl';
const FROM_COMMAND =
  'node scripts/harness.ts actions-cost --from lab/actions-cost/2026-11-17_2026-11-20.jsonl';

const HEADS = [
  '- 기준이 되는 입력:',
  '- 다시 재는 때:',
  '- 판단 시점 1(절감 수단마다):',
  '- 판단 시점 2(파일럿을 비공개 리포에서 시작하기 전):',
  '- 판단 시점 3(이 리포를 다시 비공개로 돌릴지 정할 때):',
  '- 효과가 없을 때:',
  '- 파일럿 실측:',
  '- 예산을 넘는 결정:',
];
const BUDGET_HEADS = [
  '- 상태:',
  '- 계정의 월 예산:',
  '- 프로젝트 하나의 월 PR 수:',
  '- PR 하나당 예산:',
];

function report(text: string, known: KnownNames) {
  const { period, jobs } = parseSaved(text);
  return { period, report: actionsCost(fromSaved(jobs), period, known) };
}

/** 보존 기록으로 계산한 기록 행. `verdict`는 판단 칸의 첫 낱말이다 */
function recordRow(
  text: string,
  name: string,
  means: string,
  verdict: string,
  known = NO_NAMES,
): string {
  const r = report(text, known);
  const c = recordCells(r.report, r.period);
  const cells = [
    c[0],
    means,
    c[1],
    c[2],
    c[3],
    c[4],
    c[5],
    `\`${name}\``,
    `${verdict}. 설명 한 줄`,
  ];
  return `| ${cells.join(' | ')} |`;
}

/** 모든 기대를 채운 문서. 기준선은 `text`(이름은 `BASELINE_FILE`)로 계산한다 */
function goodDoc(
  text = BASE,
  verdict = '예산 안',
  o: { known?: KnownNames; moreRows?: string[] } = {},
): string {
  const known = o.known ?? NO_NAMES;
  const r = report(text, known);
  return [
    '---',
    'status: active',
    'related_code: [scripts/metrics/actions-cost.ts]',
    'review_cycle: on-change',
    '---',
    '',
    '# Actions 비용의 판단 절차와 기준선',
    '',
    '## 왜 재는가',
    '',
    '비공개 리포에서는 Actions가 과금되고 job마다 돈 시간을 분으로 올림한다. 하네스를 쓸 프로젝트는 비공개다.',
    '공개 리포는 청구가 0이라 청구서로는 볼 수 없으므로 실행 기록으로 잰다. 포함 사용량은 계정의 비공개 리포 전체가 나눠 쓴다.',
    '',
    '## 재는 방법',
    '',
    '`node scripts/harness.ts actions-cost --since <날짜> --until <날짜>`로 잰다. `--save`는 읽은 입력을 남기고 `--from`은 남긴 입력으로 다시 계산한다.',
    'job마다 초를 분으로 올림하고 러너의 단가를 곱한다. 공개 리포에서는 실제 청구가 아니고, 값을 확인하지 못한 러너는 금액에 없다.',
    '',
    '## 예산',
    '',
    '- 상태: 확정(제작자 결정, 2026-11-21)',
    '- 계정의 월 예산: $18 (Pro의 포함 사용량)',
    '- 프로젝트 하나의 월 PR 수: 100개',
    '- PR 하나당 예산: 30분($0.18, 2코어 Linux 기준)',
    '',
    '## 기준선',
    '',
    '2026-11-17~2026-11-20(비공개 기간)의 값이다.',
    '',
    '- 잰 날짜: 2026-11-22',
    `- 잰 명령: \`${SAVE_COMMAND}\``,
    `- 다시 계산하는 명령: \`${FROM_COMMAND}\``,
    '',
    '<!-- actions-cost:begin -->',
    '',
    renderCost(r.report, r.period),
    '<!-- actions-cost:end -->',
    '',
    '## 판단 절차',
    '',
    '- 기준이 되는 입력: 기준은 보존 기록이다. 확인은 `--from`으로 하고, GitHub을 다시 읽은 값이 달라도 바꾸지 않는다.',
    '- 다시 재는 때: 절감 수단을 하나 넣을 때마다 넣기 전과 뒤를 같은 길이의 기간으로 `--save`해 재고 기록 표에 한 줄을 더한다.',
    '- 판단 시점 1(절감 수단마다): 넣기 전과 뒤의 기록 행을 견줘 PR 하나당 금액이 줄었는지 본다.',
    '- 판단 시점 2(파일럿을 비공개 리포에서 시작하기 전): 최근 기록 행이 예산 안이면 시작하고, 아니면 다음 수단을 넣는다.',
    '- 판단 시점 3(이 리포를 다시 비공개로 돌릴지 정할 때): 30일 환산 금액을 계정의 월 예산과 견줘 감당할 수 있는지 본다.',
    '- 효과가 없을 때: 전후의 값이 줄지 않았으면 그 수단을 되돌린다. 되돌린 것도 기록 표에 적는다.',
    '- 파일럿 실측: 파일럿 대상 리포에서 `check`의 실제 시간을 한 번 재서 환산에 넣는다.',
    '- 예산을 넘는 결정: 지출 한도, 요금제, 러너는 제작자가 정한다(절차서 7절).',
    '',
    '## 기록',
    '',
    TABLE_HEAD,
    TABLE_RULE,
    recordRow(text, BASELINE_FILE, '기준선', verdict, known),
    ...(o.moreRows ?? []),
    '',
  ].join('\n');
}

const check = (
  doc: string,
  files: Record<string, string> = { [BASELINE_FILE]: BASE },
  known = NO_NAMES,
) => checkDoc({ doc, saved: (name) => files[name] ?? null, known });

/** 하나라도 `re`에 맞는 어긋난 점이 있어야 한다 */
function fails(problems: string[], re: RegExp): void {
  assert.ok(problems.length > 0, '어긋난 점이 없다(통과했다)');
  assert.ok(
    problems.some((p) => re.test(p)),
    `어긋난 점에 ${String(re)}가 없다:\n${problems.join('\n')}`,
  );
}

/** 글자열을 꼭 한 번 바꾼다. 찾는 글이 없으면 테스트가 틀린 것이다 */
function swap(s: string, from: string, to: string): string {
  assert.equal(s.split(from).length, 2, `바꿀 글이 한 번 있어야 한다: ${from}`);
  return s.replace(from, () => to);
}

/** `head`로 시작하는 줄 하나를 지운다 */
function dropLine(s: string, head: string): string {
  const lines = s.split('\n');
  const kept = lines.filter((l) => !l.startsWith(head));
  assert.equal(kept.length, lines.length - 1, `지울 줄이 하나 있어야 한다: ${head}`);
  return kept.join('\n');
}

/** `## <title>` 절(제목 줄부터 다음 절 전까지)을 돌려준다 */
function sectionOf(s: string, title: string): string {
  const from = s.indexOf(`## ${title}\n`);
  assert.ok(from >= 0, `절이 있어야 한다: ${title}`);
  const next = s.indexOf('\n## ', from);
  return next < 0 ? s.slice(from) : s.slice(from, next + 1);
}

const SECTIONS = ['왜 재는가', '재는 방법', '예산', '기준선', '판단 절차', '기록'];

test('checkDoc: 바른 문서와 그 보존 기록은 통과한다', () => {
  assert.deepEqual(check(goodDoc()), []);
});

test('checkDoc: 상수는 제작자가 정한 예산과 기준선 파일이다', () => {
  assert.deepEqual(BUDGET, { accountUsd: 18, prsPerMonth: 100, minutesPerPr: 30, usdPerPr: 0.18 });
  assert.equal(BASELINE_FILE, '2026-11-17_2026-11-20.jsonl');
});

test('checkDoc: 빈 글은 여섯 절이 모두 없다고 한다', () => {
  const problems = check('');
  for (const title of SECTIONS) fails(problems, new RegExp(`## ${title}`));
});

test('checkDoc: 제목만 남긴 글은 실패한다', () => {
  const titles = goodDoc()
    .split('\n')
    .filter((l) => l.startsWith('#'))
    .join('\n');
  const problems = check(titles);
  fails(problems, /왜 재는가/);
  fails(problems, /예산/);
  fails(problems, /기준선/);
  fails(problems, /판단 절차/);
  fails(problems, /기록/);
});

for (const title of SECTIONS)
  test(`checkDoc: 절 "${title}"이 없으면 실패한다`, () => {
    const doc = goodDoc();
    fails(check(swap(doc, sectionOf(doc, title), '')), new RegExp(`## ${title}`));
  });

test('checkDoc: 절의 순서가 바뀌면 실패한다', () => {
  const doc = goodDoc();
  const why = sectionOf(doc, '왜 재는가');
  const how = sectionOf(doc, '재는 방법');
  fails(check(swap(doc, why + how, how + why)), /순서/);
});

test('checkDoc: 같은 절이 두 번 있으면 실패한다', () => {
  const doc = goodDoc();
  fails(check(doc + sectionOf(doc, '예산')), /## 예산/);
});

test('checkDoc: "왜 재는가"의 본문이 비었으면 실패한다', () => {
  const doc = goodDoc();
  fails(check(swap(doc, sectionOf(doc, '왜 재는가'), '## 왜 재는가\n\n')), /왜 재는가/);
});

test('checkDoc: "왜 재는가"·"재는 방법"에 있어야 하는 낱말이 없으면 실패한다', () => {
  const doc = goodDoc();
  fails(check(swap(doc, '포함 사용량은', '무료 분은')), /왜 재는가.*포함 사용량/);
  fails(check(swap(doc, '러너의 단가를 곱한다', '러너의 값을 곱한다')), /재는 방법.*단가/);
});

for (const head of BUDGET_HEADS)
  test(`checkDoc: 예산의 "${head}" 줄이 없으면 실패한다`, () => {
    fails(check(dropLine(goodDoc(), head)), new RegExp(`예산.*${head.slice(2, -1)}`));
  });

test('checkDoc: 예산 줄이 두 번 있으면 실패한다', () => {
  const doc = goodDoc();
  const line = '- 프로젝트 하나의 월 PR 수: 100개\n';
  fails(check(swap(doc, line, line + line)), /예산.*프로젝트 하나의 월 PR 수/);
});

test('checkDoc: 예산 값이 바뀌면 실패한다', () => {
  const doc = goodDoc();
  fails(check(swap(doc, '- PR 하나당 예산: 30분', '- PR 하나당 예산: 300분')), /PR 하나당 예산/);
  fails(check(swap(doc, '30분($0.18,', '30분($0.19,')), /PR 하나당 예산/);
  fails(check(swap(doc, '- 계정의 월 예산: $18 ', '- 계정의 월 예산: $180 ')), /계정의 월 예산/);
  fails(check(swap(doc, '월 PR 수: 100개', '월 PR 수: 1000개')), /프로젝트 하나의 월 PR 수/);
});

test('checkDoc: 예산 금액은 수로 읽는다($18.00은 $18과 같다)', () => {
  const doc = swap(goodDoc(), '- 계정의 월 예산: $18 ', '- 계정의 월 예산: $18.00 ');
  assert.deepEqual(check(doc), []);
});

test('checkDoc: 예산의 상태가 확정이 아니면 실패한다', () => {
  const doc = swap(goodDoc(), '- 상태: 확정(제작자 결정, 2026-11-21)', '- 상태: 잠정');
  fails(check(doc), /예산.*상태/);
});

test('checkDoc: 표식 구간이 비었으면 실패한다', () => {
  const doc = goodDoc();
  const begin = doc.indexOf('<!-- actions-cost:begin -->') + '<!-- actions-cost:begin -->'.length;
  const end = doc.indexOf('<!-- actions-cost:end -->');
  fails(check(`${doc.slice(0, begin)}\n\n${doc.slice(end)}`), /기준선.*표식 구간/);
});

test('checkDoc: 표식 구간의 수 하나가 바뀌면 실패한다', () => {
  const doc = goodDoc();
  const line = doc.split('\n').find((l) => /^\| 청구 분 +\| 25 +\|$/.test(l));
  assert.ok(line, '요약 표에 청구 분 25가 있어야 한다');
  fails(check(swap(doc, line, line.replace('25', '24'))), /기준선.*표식 구간/);
});

test('checkDoc: 표식 구간이 없거나 둘이면 실패한다', () => {
  const doc = goodDoc();
  fails(
    check(doc.replace('<!-- actions-cost:begin -->', '').replace('<!-- actions-cost:end -->', '')),
    /기준선.*표식 구간/,
  );
  const twice = swap(
    doc,
    '<!-- actions-cost:end -->',
    '<!-- actions-cost:end -->\n\n<!-- actions-cost:begin -->\n\n<!-- actions-cost:end -->',
  );
  fails(check(twice), /기준선.*표식 구간/);
});

test('checkDoc: 표식 구간은 빈 줄을 빼고 견준다', () => {
  const doc = swap(goodDoc(), '**요약**\n\n', '**요약**\n\n\n');
  assert.deepEqual(check(doc), []);
});

test('checkDoc: 잰 날짜가 없거나 없는 날짜이거나 결정보다 앞서면 실패한다', () => {
  const doc = goodDoc();
  fails(check(dropLine(doc, '- 잰 날짜:')), /기준선.*잰 날짜/);
  fails(check(swap(doc, '잰 날짜: 2026-11-22', '잰 날짜: 2026-11-31')), /기준선.*잰 날짜/);
  fails(check(swap(doc, '잰 날짜: 2026-11-22', '잰 날짜: 2026-11-20')), /기준선.*잰 날짜/);
  fails(check(swap(doc, '잰 날짜: 2026-11-22', '잰 날짜: 곧')), /기준선.*잰 날짜/);
});

test('checkDoc: 잰 명령이나 다시 계산하는 명령이 없으면 실패한다', () => {
  const doc = goodDoc();
  fails(check(dropLine(doc, '- 잰 명령:')), /기준선.*잰 명령/);
  fails(check(swap(doc, SAVE_COMMAND, SAVE_COMMAND.replace('.jsonl', '.json'))), /기준선.*잰 명령/);
  fails(check(dropLine(doc, '- 다시 계산하는 명령:')), /기준선.*다시 계산하는 명령/);
});

test('checkDoc: 표식 구간 안의 글은 잰 날짜·명령으로 치지 않는다', () => {
  const doc = goodDoc();
  const moved = swap(
    swap(dropLine(doc, '- 잰 날짜:'), `- 잰 명령: \`${SAVE_COMMAND}\`\n`, ''),
    '<!-- actions-cost:begin -->\n',
    `<!-- actions-cost:begin -->\n잰 날짜: 2026-11-22\n${SAVE_COMMAND}\n`,
  );
  const problems = check(moved);
  fails(problems, /기준선.*잰 날짜/);
  fails(problems, /기준선.*잰 명령/);
});

for (const head of HEADS)
  test(`checkDoc: 판단 절차의 "${head}" 항목이 없으면 실패한다`, () => {
    fails(check(dropLine(goodDoc(), head)), /판단 절차/);
    const problems = check(dropLine(goodDoc(), head));
    assert.ok(
      problems.some((p) => p.includes(head)),
      problems.join('\n'),
    );
  });

test('checkDoc: 판단 절차의 머리만 있고 내용이 비었으면 실패한다', () => {
  const doc = goodDoc();
  const line = doc.split('\n').find((l) => l.startsWith(HEADS[2]));
  assert.ok(line);
  fails(check(swap(doc, line, HEADS[2])), /판단 절차.*판단 시점 1/);
  fails(check(swap(doc, line, `${HEADS[2]} 본다.`)), /판단 절차.*판단 시점 1/);
});

test('checkDoc: 판단 절차의 머리가 목록 줄의 처음이 아니면 항목으로 치지 않는다', () => {
  const doc = swap(goodDoc(), '\n- 파일럿 실측:', '\n참고로 - 파일럿 실측:');
  fails(check(doc), /판단 절차.*파일럿 실측/);
});

test('checkDoc: 판단 절차의 내용에 있어야 하는 낱말이 없으면 실패한다', () => {
  const doc = goodDoc();
  const cases: [string, string, RegExp][] = [
    ['기준은 보존 기록이다.', '기준은 남긴 파일이다.', /기준이 되는 입력.*보존 기록/],
    ['확인은 `--from`으로 하고', '확인은 명령으로 하고', /기준이 되는 입력.*--from/],
    ['기간으로 `--save`해 재고', '기간으로 남겨 재고', /다시 재는 때.*--save/],
    ['최근 기록 행이 예산 안이면', '최근 기록 행이 기준 안이면', /판단 시점 2.*예산/],
    ['그 수단을 되돌린다. 되돌린 것도', '그 수단을 뺀다. 뺀 것도', /효과가 없을 때.*되돌린다/],
    ['리포에서 `check`의 실제', '리포에서 검사의 실제', /파일럿 실측.*check/],
    ['러너는 제작자가 정한다', '러너는 사람이 정한다', /예산을 넘는 결정.*제작자/],
  ];
  for (const [from, to, re] of cases) fails(check(swap(doc, from, to)), re);
});

test('checkDoc: 판단 절차의 내용은 다음 머리 전까지다(이어지는 줄을 함께 읽는다)', () => {
  const doc = swap(
    goodDoc(),
    '그 수단을 되돌린다. 되돌린 것도 기록 표에 적는다.',
    '전후의 기록 행을 먼저 다시 확인한다.\n  그래도 같으면 그 수단을 되돌린다.',
  );
  assert.deepEqual(check(doc), []);
});

test('checkDoc: 기록 표가 없거나 머리 줄뿐이면 실패한다', () => {
  const doc = goodDoc();
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  fails(check(swap(doc, `${row}\n`, '')), /기록.*행/);
  fails(check(swap(doc, `${TABLE_HEAD}\n${TABLE_RULE}\n${row}\n`, '')), /기록.*표/);
});

test('checkDoc: 기록 표의 머리 줄이 다르면 실패한다', () => {
  const doc = swap(goodDoc(), '| 30일 환산 금액 | 보존 기록 |', '| 보존 기록 | 30일 환산 금액 |');
  fails(check(doc), /기록.*머리 줄/);
});

test('checkDoc: 기록 절에 표가 둘이면 실패한다', () => {
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  const doc = `${goodDoc()}\n설명 한 줄.\n\n${TABLE_HEAD}\n${TABLE_RULE}\n${row}\n`;
  fails(check(doc), /기록.*표/);
});

test('checkDoc: 기록 행이 기간 칸만 있으면 실패한다', () => {
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  fails(check(swap(goodDoc(), row, '| 2026-11-17~2026-11-20 |')), /기록 1행/);
});

test('checkDoc: 기록 행의 칸 하나가 비었으면 실패한다', () => {
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  const cells = row.split(' | ');
  for (const i of [1, 2, 6, 8]) {
    const broken = cells.map((c, k) => (k === i ? (k === 8 ? ' |' : '') : c)).join(' | ');
    fails(check(swap(goodDoc(), row, broken)), /기록 1행/);
  }
});

test('checkDoc: 첫 행의 수단이 기준선이 아니거나 보존 기록이 기준선 파일이 아니면 실패한다', () => {
  const doc = goodDoc();
  fails(check(swap(doc, '| 기준선 |', '| 처음 |')), /기록 1행.*수단/);
  const other = '2026-11-18_2026-11-19.jsonl';
  const text = savedText([{ pr: 1, minutes: 10 }], { since: '2026-11-18', until: '2026-11-19' });
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  const replaced = swap(doc, row, recordRow(text, other, '기준선', '예산 안'));
  fails(check(replaced, { [BASELINE_FILE]: BASE, [other]: text }), /기록 1행.*보존 기록/);
});

test('checkDoc: 기록 행의 수가 보존 기록과 다르면 실패한다', () => {
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  const cells = row.split(' | ');
  assert.equal(cells[2], '25');
  const names = [
    '기간',
    '',
    '청구 분',
    'PR 하나당 청구 분',
    'PR 하나당 금액',
    'PR head 하나당 청구 분',
    '30일 환산 금액',
  ];
  for (const i of [2, 3, 4, 5, 6]) {
    const broken = cells.map((c, k) => (k === i ? `${c}9` : c)).join(' | ');
    fails(check(swap(goodDoc(), row, broken)), new RegExp(`기록 1행.*${names[i]}`));
  }
  const period = cells.map((c, k) => (k === 0 ? '| 2026-11-17~2026-11-19' : c)).join(' | ');
  fails(check(swap(goodDoc(), row, period)), /기록 1행.*기간/);
});

test('checkDoc: 판단이 정한 낱말로 시작하지 않거나 설명이 없으면 실패한다', () => {
  const doc = goodDoc();
  fails(check(swap(doc, '| 예산 안. 설명 한 줄 |', '| 괜찮다. 설명 한 줄 |')), /기록 1행.*판단/);
  fails(check(swap(doc, '| 예산 안. 설명 한 줄 |', '| 예산 안 |')), /기록 1행.*판단/);
  fails(check(swap(doc, '| 예산 안. 설명 한 줄 |', '| 예산 안. |')), /기록 1행.*판단/);
});

test('checkDoc: 판단이 값과 어긋나면 실패한다(예산 밖이어야 하는데 예산 안)', () => {
  // PR 하나, 31분: 186밀리달러 > 180
  const over = savedText([{ pr: 1, minutes: 31 }]);
  const files = { [BASELINE_FILE]: over };
  fails(check(goodDoc(over, '예산 안'), files), /기록 1행.*판단.*예산 밖/);
  assert.deepEqual(check(goodDoc(over, '예산 밖'), files), []);
  // 거꾸로: 예산 안인데 예산 밖이라고 적었다
  fails(check(goodDoc(BASE, '예산 밖')), /기록 1행.*판단.*예산 안/);
});

test('checkDoc: PR이 없으면 판단 못 함이다', () => {
  const none = savedText([{ pr: null, minutes: 5 }]);
  const files = { [BASELINE_FILE]: none };
  assert.deepEqual(check(goodDoc(none, '판단 못 함'), files), []);
  fails(check(goodDoc(none, '예산 안'), files), /기록 1행.*판단.*판단 못 함/);
});

test('checkDoc: 단가를 모르는 러너의 분이 있으면 예산 안이라고 할 수 없다', () => {
  // 확인된 금액은 PR 하나당 $0.12(20분), 모르는 러너의 청구 20분
  const text = savedText([
    { pr: 1, minutes: 20 },
    { pr: 1, minutes: 20, labels: UNKNOWN },
  ]);
  const files = { [BASELINE_FILE]: text };
  assert.equal(report(text, NO_NAMES).report.unknownMinutes, 20);
  assert.equal(report(text, NO_NAMES).report.usdMilli, 120);
  fails(check(goodDoc(text, '예산 안'), files), /기록 1행.*판단.*판단 못 함/);
  assert.deepEqual(check(goodDoc(text, '판단 못 함'), files), []);
});

test('checkDoc: 단가를 모르는 러너의 분이 있어도 확인된 금액만으로 예산을 넘으면 예산 밖이다', () => {
  const text = savedText([
    { pr: 1, minutes: 31 },
    { pr: 1, minutes: 20, labels: UNKNOWN },
  ]);
  const files = { [BASELINE_FILE]: text };
  assert.deepEqual(check(goodDoc(text, '예산 밖'), files), []);
  fails(check(goodDoc(text, '판단 못 함'), files), /기록 1행.*판단.*예산 밖/);
});

test('checkDoc: self-hosted 러너의 분은 판단을 바꾸지 않는다', () => {
  const text = savedText([
    { pr: 1, minutes: 20 },
    { pr: 1, minutes: 500, labels: SELF_HOSTED },
  ]);
  assert.deepEqual(check(goodDoc(text, '예산 안'), { [BASELINE_FILE]: text }), []);
});

/** PR 30개에 job 하나씩. `minutes[i]`분을 돈다 */
const thirty = (extra: number) =>
  savedText(
    Array.from({ length: 30 }, (_, i) => ({ pr: i + 1, minutes: i === 0 ? 30 + extra : 30 })),
  );

test('checkDoc: PR 하나당 금액이 꼭 $0.18이면 예산 안이다(PR 30개, 청구 900분)', () => {
  const text = thirty(0);
  const r = report(text, NO_NAMES).report;
  assert.equal(r.minutes, 900);
  assert.equal(r.usdMilli, 180 * 30);
  const files = { [BASELINE_FILE]: text };
  assert.deepEqual(check(goodDoc(text, '예산 안'), files), []);
  fails(check(goodDoc(text, '예산 밖'), files), /기록 1행.*판단.*예산 안/);
});

test('checkDoc: 1밀리달러에 못 미치게 넘어도 예산 밖이다(PR 30개, 청구 901분)', () => {
  const text = thirty(1);
  const r = report(text, NO_NAMES);
  assert.equal(r.report.minutes, 901);
  assert.equal(r.report.usdMilli, 5406);
  // 표시는 반올림돼 $0.180이다. 칸의 글로 견주면 넘은 것을 놓친다
  assert.equal(recordCells(r.report, r.period)[3], '$0.180');
  const files = { [BASELINE_FILE]: text };
  assert.deepEqual(check(goodDoc(text, '예산 밖'), files), []);
  fails(check(goodDoc(text, '예산 안'), files), /기록 1행.*판단.*예산 밖/);
});

test('checkDoc: 보존 기록이 없으면 실패한다', () => {
  const problems = check(goodDoc(), {});
  fails(problems, /기준선.*보존 기록/);
  fails(problems, /기록 1행.*보존 기록/);
});

test('checkDoc: 보존 기록의 줄 하나가 빠지면 실패한다', () => {
  const lines = BASE.split('\n');
  const cut = [...lines.slice(0, -2), ''].join('\n');
  fails(check(goodDoc(), { [BASELINE_FILE]: cut }), /기준선.*보존 기록/);
});

test('checkDoc: 기준선 보존 기록의 기간이 다르면 실패한다', () => {
  const period = { since: '2026-11-17', until: '2026-11-19' };
  const text = savedText([{ pr: 1, minutes: 10 }], period);
  fails(check(goodDoc(text), { [BASELINE_FILE]: text }), /기준선.*기간/);
});

test('checkDoc: 허용 목록이 달라 출력이 달라지면 실패한다(같은 보존 기록으로 다시 계산해 붙인다)', () => {
  const text = savedText([{ pr: 1, minutes: 10, workflow: 'check', job: 'check' }]);
  const known: KnownNames = new Map([['check', new Set(['check'])]]);
  const files = { [BASELINE_FILE]: text };
  const doc = goodDoc(text, '예산 안', { known });
  assert.deepEqual(check(doc, files, known), []);
  fails(check(doc, files, NO_NAMES), /기준선.*표식 구간/);
});

test('checkDoc: 둘째 기록 행도 그 보존 기록으로 계산한 값이어야 한다', () => {
  const period = { since: '2026-11-25', until: '2026-11-28' };
  const name = '2026-11-25_2026-11-28.jsonl';
  const text = savedText([{ pr: 9, minutes: 31 }], period);
  const files = { [BASELINE_FILE]: BASE, [name]: text };
  const row = recordRow(text, name, 'concurrency', '예산 밖');
  assert.deepEqual(check(goodDoc(BASE, '예산 안', { moreRows: [row] }), files), []);
  const wrong = recordRow(text, name, 'concurrency', '예산 안');
  fails(check(goodDoc(BASE, '예산 안', { moreRows: [wrong] }), files), /기록 2행.*판단.*예산 밖/);
  fails(
    check(goodDoc(BASE, '예산 안', { moreRows: [row] }), { [BASELINE_FILE]: BASE }),
    /기록 2행.*보존 기록/,
  );
});

test('checkDoc: 보존 기록 칸이 정한 꼴의 이름이 아니면 그 파일을 읽지 않고 실패한다', () => {
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  const asked: string[] = [];
  for (const bad of ['../secret.jsonl', 'baseline.jsonl', '2026-11-25_2026-11-28.json']) {
    const more = swap(row, `\`${BASELINE_FILE}\``, `\`${bad}\``).replace('| 기준선 |', '| 수단 |');
    const problems = checkDoc({
      doc: goodDoc(BASE, '예산 안', { moreRows: [more] }),
      saved: (name) => {
        asked.push(name);
        return name === BASELINE_FILE ? BASE : null;
      },
      known: NO_NAMES,
    });
    fails(problems, /기록 2행.*보존 기록/);
  }
  assert.deepEqual([...new Set(asked)], [BASELINE_FILE]);
});

test('check-doc 명령: 바른 문서는 0, 어긋난 문서는 1과 어긋난 점의 목록이다', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-doc-'));
  const doc = path.join(dir, 'doc.md');
  writeFileSync(path.join(dir, BASELINE_FILE), BASE);
  writeFileSync(doc, goodDoc());
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });

  const ok = run('--doc', doc, '--dir', dir);
  assert.equal(ok.status, 0, ok.stderr);

  writeFileSync(doc, dropLine(goodDoc(), '- PR 하나당 예산:'));
  const bad = run('--doc', doc, '--dir', dir);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /예산.*PR 하나당 예산/);

  const empty = mkdtempSync(path.join(os.tmpdir(), 'check-doc-'));
  writeFileSync(doc, goodDoc());
  const noSaved = run('--doc', doc, '--dir', empty);
  assert.equal(noSaved.status, 1);
  assert.match(noSaved.stderr, /보존 기록/);
});

test('check-doc 명령: 인자가 틀리거나 문서를 읽지 못하면 1이다', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-doc-'));
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
  for (const args of [['--nope'], ['--doc'], ['--dir'], ['extra'], ['--doc', 'a', '--doc', 'b']]) {
    const r = run(...args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /사용법/);
  }
  const missing = run('--doc', path.join(dir, 'none.md'), '--dir', dir);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /문서를 읽지 못했다/);
  // 절대 경로를 오류 글에 옮기지 않는다
  assert.ok(!missing.stderr.includes(dir));
});

// ---- 코드 판정 1라운드(F2~F4)와 같은 종류의 구멍: 화면에 보이는 문서가 틀렸는데 통과하면 안 된다 ----

test('checkDoc: 기록 표의 구분 줄은 머리 줄과 칸 수가 같아야 한다', () => {
  const doc = goodDoc();
  fails(check(swap(doc, TABLE_RULE, '| --- |')), /기록.*구분 줄/);
  fails(check(swap(doc, TABLE_RULE, `${TABLE_RULE} --- |`)), /기록.*구분 줄/);
});

test('checkDoc: 판단 절차의 내용은 그 항목에 속한 줄만 센다(다음 목록 항목이나 문단은 세지 않는다)', () => {
  const doc = goodDoc();
  const line = doc.split('\n').find((l) => l.startsWith(HEADS[4]));
  assert.ok(line);
  const item = `${HEADS[4]}\n- 이 줄은 머리가 다른 별개의 목록 항목이고 스무 자를 넘는다.`;
  fails(check(swap(doc, line, item)), /판단 절차.*판단 시점 3.*20자/);
  const para = `${HEADS[4]}\n\n이 줄은 목록 밖의 문단이고 공백을 빼고도 스무 자를 넘는다.\n`;
  fails(check(swap(doc, line, para)), /판단 절차.*판단 시점 3.*20자/);
  // 마지막 항목도 절의 끝까지 읽지 않는다
  const last = doc.split('\n').find((l) => l.startsWith(HEADS[7]));
  assert.ok(last);
  const tail = `${HEADS[7]}\n\n제작자가 정한다는 것을 목록 밖의 문단에만 적었다. 스무 자를 넘는다.`;
  fails(check(swap(doc, last, tail)), /판단 절차.*예산을 넘는 결정/);
});

test('checkDoc: 잰 명령과 다시 계산하는 명령은 코드로 적은 명령 전체가 같아야 한다', () => {
  const doc = goodDoc();
  const from = `\`${FROM_COMMAND}\``;
  const save = `\`${SAVE_COMMAND}\``;
  fails(check(swap(doc, from, `\`${FROM_COMMAND}.bak\``)), /기준선.*다시 계산하는 명령/);
  fails(check(swap(doc, save, `\`${SAVE_COMMAND}.bak\``)), /기준선.*잰 명령/);
  fails(
    check(swap(doc, from, `\`${FROM_COMMAND} --since 2026-11-18\``)),
    /기준선.*다시 계산하는 명령/,
  );
  // 코드 구간(백틱)이나 코드 블록 밖의 글은 명령으로 치지 않는다
  fails(check(swap(doc, from, FROM_COMMAND)), /기준선.*다시 계산하는 명령/);
  // 코드 블록의 한 줄로 적어도 된다
  const block = swap(
    doc,
    `- 다시 계산하는 명령: ${from}\n`,
    `- 다시 계산하는 명령:\n\n\`\`\`bash\n${FROM_COMMAND}\n\`\`\`\n`,
  );
  assert.deepEqual(check(block), []);
});

const F3 = '```';
const fence = (s: string) => `${F3}text\n${s}\n${F3}`;
const BEGIN_MARK = '<!-- actions-cost:begin -->';
const END_MARK = '<!-- actions-cost:end -->';
const WORD = '포함 사용량은';

/** 어긋난 점이 모두 형식의 것이고 그 가운데 `re`에 맞는 것이 있다(다른 절의 오류로 번지지 않는다) */
function formatOnly(problems: string[], re: RegExp): void {
  fails(problems, re);
  assert.deepEqual(
    problems.filter((p) => !p.startsWith('형식')),
    [],
  );
}

test('checkDoc: 코드 블록 안의 줄은 절·예산 줄·항목·표로 치지 않는다', () => {
  const doc = goodDoc();
  const budget = '- PR 하나당 예산: 30분($0.18, 2코어 Linux 기준)';
  fails(check(swap(doc, budget, fence(budget))), /예산.*PR 하나당 예산/);
  const item = doc.split('\n').find((l) => l.startsWith(HEADS[5]));
  assert.ok(item);
  fails(check(swap(doc, item, fence(item))), /판단 절차.*효과가 없을 때/);
  const table = `${TABLE_HEAD}\n${TABLE_RULE}\n${recordRow(BASE, BASELINE_FILE, '기준선', '예산 안')}`;
  fails(check(swap(doc, table, fence(table))), /기록.*표/);
  fails(check(swap(doc, '## 예산\n', `${fence('## 예산')}\n`)), /## 예산/);
  const date = '- 잰 날짜: 2026-11-22';
  fails(check(swap(doc, date, fence(date))), /기준선.*잰 날짜/);
});

test('checkDoc: 코드 블록 안의 글은 본문의 낱말로 친다(명령 예시를 코드 블록에 적는다)', () => {
  const doc = swap(
    goodDoc(),
    '`node scripts/harness.ts actions-cost --since <날짜> --until <날짜>`로 잰다.',
    `아래 명령으로 잰다.\n\n${F3}bash\nnode scripts/harness.ts actions-cost --since <날짜> --until <날짜>\n${F3}\n`,
  );
  assert.deepEqual(check(doc), []);
});

test('checkDoc: 표식이 코드 블록 안에 있으면 표식 구간으로 치지 않는다', () => {
  const doc = goodDoc();
  const begin = doc.indexOf(BEGIN_MARK);
  const end = doc.indexOf(END_MARK) + END_MARK.length;
  const wrapped = `${doc.slice(0, begin)}${fence(doc.slice(begin, end))}${doc.slice(end)}`;
  fails(check(wrapped), /기준선.*표식 구간/);
});

// ---- 코드 판정 2라운드(F3의 남은 경우) ----

test('checkDoc: 판단 절차에서 두 칸보다 덜 들여 쓴 줄은 그 항목의 내용이 아니다', () => {
  const doc = goodDoc();
  const line = doc.split('\n').find((l) => l.startsWith(HEADS[4]));
  assert.ok(line);
  // 공백 한 칸으로 시작하는 목록 항목은 화면에서 같은 수준의 별개 항목이다
  const sibling = `${HEADS[4]}\n - 이 줄은 한 칸 들여 쓴 별개의 목록 항목이고 스무 자를 넘는다.`;
  fails(check(swap(doc, line, sibling)), /판단 절차.*판단 시점 3.*20자/);
  // 두 칸이나 세 칸 들여 쓴 줄(이어지는 글, 하위 목록)은 그 항목의 내용이다
  const nested = `${HEADS[4]}\n  - 30일 환산 금액을 계정의 월 예산과 견줘 감당할 수 있는지 본다.`;
  assert.deepEqual(check(swap(doc, line, nested)), []);
});

// ---- 코드 판정 3라운드(F6, F7): 검사가 읽는 형식만 받는다. 벗어난 문서는 "형식"으로 거부한다 ----
// Markdown을 흉내 내어 해석하지 않는다: 해석이 GitHub과 어긋나는 자리마다 가려진 글이 통과하거나(F6)
// 바른 문서의 뒤쪽이 통째로 가려졌다(F5, F7).

test('checkDoc 형식: 코드 밖에 HTML 태그와 주석을 쓰지 않는다(표식 두 줄만 예외)', () => {
  const doc = goodDoc();
  // 주석으로 가린 글은 통과하지 못한다. 주석을 풀어 읽지 않으므로 다른 오류로 번지지도 않는다
  const budget = '- PR 하나당 예산: 30분($0.18, 2코어 Linux 기준)';
  formatOnly(check(swap(doc, budget, `<!--\n${budget}\n-->`)), /형식.*HTML/);
  fails(check(swap(doc, budget, `<!-- ${budget} -->`)), /형식.*HTML/);
  formatOnly(check(swap(doc, WORD, `<!-- 메모 -->${WORD}`)), /형식.*HTML/);
  formatOnly(check(swap(doc, WORD, `<!-- ${WORD} -->무료 분은`)), /형식.*HTML/);
  formatOnly(check(swap(doc, WORD, `<span hidden>${WORD}</span>`)), /형식.*HTML/);
  formatOnly(check(swap(doc, '## 예산\n', '<details>\n\n## 예산\n')), /형식.*HTML/);
  // 표식은 줄 전체가 표식일 때만 표식이다
  fails(check(swap(doc, BEGIN_MARK, `  ${BEGIN_MARK}`)), /형식.*HTML/);
  fails(check(swap(doc, END_MARK, `${END_MARK} 끝`)), /형식.*HTML/);
});

test('checkDoc 형식: 역슬래시를 쓰지 않는다(이스케이프한 백틱 뒤의 주석이 코드로 읽히지 않는다)', () => {
  const doc = goodDoc();
  // F6: 화면에서는 주석이 가려지는데 백틱 한 쌍 사이의 글로 읽혔다
  formatOnly(check(swap(doc, WORD, `\\\`<!-- ${WORD} -->\` 무료 분은`)), /형식.*역슬래시/);
  formatOnly(check(swap(doc, WORD, `\\*${WORD}`)), /형식.*역슬래시/);
});

test('checkDoc 형식: 백틱 안의 <는 글이다. 백틱의 짝은 한 줄 안에서 맞아야 한다', () => {
  const doc = goodDoc();
  // F5: 백틱 안의 주석 시작 문자열이 뒤의 문서를 가리지 않는다
  assert.deepEqual(check(swap(doc, WORD, `표식은 \`<!--\`로 시작하는 주석이다. ${WORD}`)), []);
  assert.deepEqual(check(swap(doc, WORD, `표식은 \`<!-- … -->\` 꼴이다. ${WORD}`)), []);
  assert.deepEqual(check(swap(doc, WORD, `표식은 \`\`<!-- \` -->\`\` 꼴이다. ${WORD}`)), []);
  // 짝이 없는 백틱, 줄을 넘는 코드 구간
  formatOnly(check(swap(doc, WORD, `\`${WORD}`)), /형식.*백틱의 짝/);
  formatOnly(check(swap(doc, WORD, `\`\`a\` ${WORD}`)), /형식.*백틱의 짝/);
  fails(check(swap(doc, WORD, `\`포함\n사용량은\``)), /형식.*백틱의 짝/);
  // 표의 칸은 백틱 안의 |에서도 갈리므로 |가 있는 줄에서는 백틱 안에도 <를 쓰지 않는다
  fails(
    check(swap(doc, '예산 안. 설명 한 줄', '예산 안. `a | <!-- 예산 밖 --> | b`')),
    /형식.*표의 칸/,
  );
  formatOnly(check(swap(doc, '예산 안. 설명 한 줄', '예산 안. `<분>` 설명')), /형식.*표의 칸/);
});

test('checkDoc: 명령은 백틱 묶음의 길이가 같은 코드 구간 전체로 읽는다', () => {
  const doc = goodDoc();
  const from = `\`${FROM_COMMAND}\``;
  // 화면에는 "<명령>`.bak"이 한 덩어리의 코드로 보인다
  fails(check(swap(doc, from, `\`\`${FROM_COMMAND}\`.bak\`\``)), /기준선.*다시 계산하는 명령/);
  assert.deepEqual(check(swap(doc, from, `\`\`${FROM_COMMAND}\`\``)), []);
});

test('checkDoc 형식: 코드 블록은 줄 머리의 백틱 세 개로만 여닫는다', () => {
  const doc = goodDoc();
  // F7: 들여 쓴 물결 줄 하나가 뒤의 절을 가리지 않는다. 그 줄만 형식 오류다
  formatOnly(check(swap(doc, END_MARK, `${END_MARK}\n\n    ~~~~`)), /형식.*코드 블록은/);
  formatOnly(check(swap(doc, END_MARK, `${END_MARK}\n\n    ${F3}`)), /형식.*코드 블록은/);
  const budget = '- PR 하나당 예산: 30분($0.18, 2코어 Linux 기준)';
  fails(check(swap(doc, budget, `~~~\n${budget}\n~~~`)), /형식.*코드 블록은/);
  fails(check(swap(doc, budget, `${F3}\`\n${budget}\n${F3}\``)), /형식.*코드 블록은/);
  fails(
    check(swap(doc, budget, `- 예시\n\n  ${F3}text\n  ${budget}\n  ${F3}`)),
    /형식.*코드 블록은/,
  );
  fails(check(swap(doc, budget, `${F3} text\n${budget}\n${F3}`)), /형식.*코드 블록은/);
  // 닫히지 않은 코드 블록이 문서의 끝까지 삼키지 않는다
  formatOnly(check(`${doc}\n${F3}bash\nnode x\n`), /형식.*닫히지/);
  // 코드 블록 안의 백틱 세 개 줄은 화면에서 블록을 닫을 수 있다
  formatOnly(
    check(swap(doc, END_MARK, `${END_MARK}\n\n${F3}text\n ${F3}\n${F3}`)),
    /형식.*코드 블록 안/,
  );
});

test('checkDoc 형식: 줄 머리를 네 칸 이상이나 탭으로 들여 쓰지 않는다', () => {
  const doc = goodDoc();
  const date = '- 잰 날짜: 2026-11-22';
  formatOnly(check(swap(doc, date, `${date}\n\n    들여 쓴 코드`)), /형식.*들여/);
  fails(check(swap(doc, date, `    ${date}`)), /형식.*들여/);
  fails(check(swap(doc, date, `\t${date}`)), /형식.*공백/);
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  fails(check(swap(doc, row, `    ${row}`)), /형식.*들여/);
});

test('checkDoc 형식: 밑줄 제목·가로줄·참조 정의·그림·제목을 단 링크를 쓰지 않는다', () => {
  const doc = goodDoc();
  // 밑줄 제목은 검사가 모르는 절을 만든다
  formatOnly(check(swap(doc, '## 기록\n', '## 기록\n\n가짜 절\n---\n')), /형식.*밑줄/);
  formatOnly(check(swap(doc, '## 기록\n', '## 기록\n\n가짜 문서\n===\n')), /형식.*밑줄/);
  // 화면에 나오지 않는 글
  formatOnly(check(swap(doc, WORD, `${WORD}\n\n[//]: # (가려진 글)\n`)), /형식.*참조 정의/);
  formatOnly(check(swap(doc, WORD, `[무료 분](x.md "${WORD}")`)), /형식.*링크/);
  formatOnly(check(swap(doc, WORD, `[무료 분](x.md\n"${WORD}")`)), /형식.*링크/);
  formatOnly(check(swap(doc, WORD, `![${WORD}](x.png)`)), /형식.*그림/);
});

test('checkDoc: 링크의 주소는 글로 세지 않는다', () => {
  const doc = goodDoc();
  assert.deepEqual(check(swap(doc, WORD, '[포함 사용량](../x.md)은')), []);
  const line = doc.split('\n').find((l) => l.startsWith(HEADS[4]));
  assert.ok(line);
  const link = `${HEADS[4]} [가](${'a'.repeat(40)}.md)`;
  fails(check(swap(doc, line, link)), /판단 절차.*판단 시점 3.*20자/);
});

test('checkDoc 형식: 목록이나 인용 안의 참조 정의도 쓰지 않는다', () => {
  const doc = goodDoc();
  formatOnly(check(swap(doc, WORD, `${WORD}\n\n- [가]: x "가려진 글"\n`)), /형식.*참조 정의/);
  formatOnly(check(swap(doc, WORD, `${WORD}\n\n> [가]: x\n`)), /형식.*참조 정의/);
  formatOnly(check(swap(doc, WORD, `${WORD}\n\n[^1]: 각주\n`)), /형식.*참조 정의/);
});

test('checkDoc: 코드 블록의 언어 이름에는 공백과 백틱만 쓰지 못한다', () => {
  assert.deepEqual(check(`${goodDoc()}\n\n${F3}c++\nint x;\n${F3}\n`), []);
});

test('checkDoc: 기록 표의 앞뒤에는 빈 줄을 둔다(붙여 쓴 줄은 화면에서 표의 행이 된다)', () => {
  const doc = goodDoc();
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  // |로 시작하지 않아도 화면에서는 표의 행이다. 값을 견주지 않은 행이 표에 보이면 안 된다
  const loose =
    '2026-11-21~2026-11-22 | 캐시 | 1 | 1.0 | $0.001 | 1.0 | $1.00 | 없음 | 예산 안. 좋다';
  fails(check(swap(doc, row, `${row}\n${loose}`)), /기록.*빈 줄/);
  fails(check(swap(doc, TABLE_HEAD, `표 설명\n${TABLE_HEAD}`)), /기록.*빈 줄/);
  assert.deepEqual(check(swap(doc, row, `${row}\n\n표 아래의 설명이다.`)), []);
});

test('checkDoc: 파일 머리의 BOM은 떼고 읽는다. 줄 머리의 다른 공백 글자는 형식 오류다', () => {
  assert.deepEqual(check(`\uFEFF${goodDoc()}`), []);
  formatOnly(
    check(swap(goodDoc(), WORD, `${WORD}\n\n\u3000전각 공백으로 들여 쓴 줄`)),
    /형식.*공백/,
  );
});

// ---- 코드 판정 4라운드(F8, F9)와 같은 종류: 화면에는 보이는데 검사가 건너뛰는 줄 ----

const LOOSE_ROW =
  '2026-11-21~2026-11-22 | 캐시 | 1 | 1.0 | $0.001 | 1.0 | $1.00 | 없음 | 예산 안. 좋다';

test('checkDoc 형식: 공백은 보통 공백만 쓴다(다른 공백 글자만 있는 줄은 빈 줄이 아니다)', () => {
  const doc = goodDoc();
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  // F8: 줄바꿈 없는 공백만 있는 줄은 화면에서 표를 끝내지 않는다. 그 뒤의 행이 같은 표에 보인다
  fails(check(swap(doc, row, `${row}\n\u00A0\n${LOOSE_ROW}`)), /형식.*공백/);
  // 그 줄은 빈 줄이 아니므로 "표의 앞뒤에 빈 줄"도 함께 어긋난다
  fails(check(swap(doc, row, `${row}\n\u00A0`)), /형식.*공백/);
  fails(check(swap(doc, row, `${row}\n\u00A0`)), /기록.*빈 줄/);
  fails(check(swap(doc, row, `${row}\n\u3000\u2003`)), /형식.*공백/);
  // 줄 안의 공백 글자, 낱개 CR(화면에서는 줄이 갈린다)
  formatOnly(check(swap(doc, WORD, `포함\u00A0사용량은 ${WORD}`)), /형식.*공백/);
  formatOnly(check(swap(doc, WORD, `${WORD}\r`)), /형식.*공백/);
  formatOnly(check(swap(doc, WORD, `포함\t사용량은 ${WORD}`)), /형식.*공백/);
  // 공백과 탭만 있는 줄은 빈 줄이다
  assert.deepEqual(check(swap(doc, row, `${row}\n  \t\n표 아래의 설명이다.`)), []);
});

test('checkDoc 형식: 링크의 주소에 |를 쓰지 않는다(표의 칸은 링크보다 먼저 갈린다)', () => {
  const doc = goodDoc();
  // F9: 주소를 뺀 뒤에 칸을 세면 아홉 칸이지만 화면에서는 열 칸으로 갈려 값이 어긋난다
  fails(check(swap(doc, '예산 안. 설명 한 줄', '예산 안. [설명](x|y) 한 줄')), /형식.*링크/);
  formatOnly(check(swap(doc, WORD, `[무료 분](x|y) ${WORD}`)), /형식.*링크/);
});

test('checkDoc: 기록 절에서 |는 표의 줄에만 쓴다(|로 시작하지 않는 줄도 화면에서 표가 된다)', () => {
  const doc = goodDoc();
  const row = recordRow(BASE, BASELINE_FILE, '기준선', '예산 안');
  // 빈 줄로 띄운 둘째 표: 값을 견주지 않은 표가 화면에 보인다
  const second = '기간 | 청구 분\n--- | ---\n2026-11-21~2026-11-22 | 1';
  fails(check(swap(doc, row, `${row}\n\n${second}`)), /기록.*표 밖/);
  fails(check(swap(doc, row, `${row}\n\n${LOOSE_ROW}`)), /기록.*표 밖/);
});

test('checkDoc: 예산 줄과 판단 절차의 항목은 한 곳에만 적는다(모양만 다른 둘째 줄이 화면에 보이면 안 된다)', () => {
  const doc = goodDoc();
  const budget = '- PR 하나당 예산: 30분($0.18, 2코어 Linux 기준)';
  fails(
    check(swap(doc, budget, `${budget}\n - PR 하나당 예산: 300분($1.80)`)),
    /예산.*PR 하나당 예산.*더 있다/,
  );
  fails(
    check(swap(doc, budget, `${budget}\n\n* PR 하나당 예산: 300분($1.80)`)),
    /예산.*PR 하나당 예산.*더 있다/,
  );
  fails(check(swap(doc, budget, `${budget}\n  - 상태: 잠정`)), /예산.*상태.*더 있다/);
  const item = doc.split('\n').find((l) => l.startsWith(HEADS[5]));
  assert.ok(item);
  fails(
    check(
      swap(
        doc,
        item,
        `${item}\n - 효과가 없을 때: 그대로 둔다. 스무 자를 넘게 적은 다른 항목이다.`,
      ),
    ),
    /판단 절차.*효과가 없을 때.*더 있다/,
  );
});
