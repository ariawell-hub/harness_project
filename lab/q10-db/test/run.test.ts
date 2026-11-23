// run.ts 테스트: 절차의 단계와 순서, 실패한 자리에서 멈추는지, 인자를 거부하는지를 본다.
// trial.ts의 인자 검사(trial-args.ts)도 본다. 네트워크를 쓰지 않고 trial.ts를 불러오거나 실행하지 않는다
// (trial.ts는 불러오기만 해도 실측이 돈다).
//   node --test lab/q10-db/test/run.test.ts
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { USAGE, parseArgs, planSteps, runSteps, spawnStep, type Step } from '../run.ts';
import { TRIAL_USAGE, parseTrialArgs } from '../trial-args.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'run.ts');
const TRIAL = path.join(HERE, '..', 'trial.ts');
const NAME = `${process.platform}-${process.arch}`;
const WORK = path.join('somewhere', 'q10-work');

const names = (steps: Step[]) => steps.map((s) => s.name);

test('기본 절차: 실행 → 포맷 → 결과 검사 → 검사 스크립트의 테스트', () => {
  const steps = planSteps({ skipFmt: false, workDir: WORK });
  assert.deepEqual(names(steps), ['trial', 'fmt', 'check', 'test']);
  assert.deepEqual(steps[0].args, ['lab/q10-db/trial.ts', WORK]);
  assert.deepEqual(steps[1].args, ['scripts/harness.ts', 'fmt']);
  assert.deepEqual(steps[2].args, ['lab/q10-db/check-results.ts', NAME]);
  assert.deepEqual(steps[3].args, ['--test', 'lab/q10-db/test/check-results.test.ts']);
});

test('--skip-fmt: 포맷 단계만 빠진다', () => {
  const steps = planSteps({ skipFmt: true, workDir: WORK });
  assert.deepEqual(names(steps), ['trial', 'check', 'test']);
  assert.deepEqual(steps[0].args, ['lab/q10-db/trial.ts', WORK]);
  assert.deepEqual(steps[1].args, ['lab/q10-db/check-results.ts', NAME]);
  assert.deepEqual(steps[2].args, ['--test', 'lab/q10-db/test/check-results.test.ts']);
});

test('인자: 받는 것은 --skip-fmt 하나뿐이다. 그 밖의 인자는(--out 포함) 오류다', () => {
  assert.deepEqual(parseArgs([]), { skipFmt: false });
  assert.deepEqual(parseArgs(['--skip-fmt']), { skipFmt: true });
  assert.equal(parseArgs(['--bogus']), null);
  assert.equal(parseArgs(['--out']), null);
  assert.equal(parseArgs(['--out', 'x.json']), null);
  assert.equal(parseArgs(['--skip-fmt', '--out', 'x.json']), null);
  assert.equal(parseArgs(['--out=x.json']), null);
  assert.equal(parseArgs(['extra']), null);
  assert.equal(USAGE, '사용법: node lab/q10-db/run.ts [--skip-fmt]');
});

const STEPS: Step[] = [
  { name: 'a', args: ['a'] },
  { name: 'b', args: ['b'] },
  { name: 'c', args: ['c'] },
];

test('모든 단계가 통과하면 0이고 차례로 한 번씩 돈다', () => {
  const ran: string[] = [];
  const code = runSteps(STEPS, (s) => {
    ran.push(s.name);
    return 0;
  });
  assert.equal(code, 0);
  assert.deepEqual(ran, ['a', 'b', 'c']);
});

test('가운데 단계가 실패하면 뒤 단계를 돌리지 않고 1이다', () => {
  for (const bad of [1, 2, 127, null]) {
    const ran: string[] = [];
    const messages: string[] = [];
    const code = runSteps(
      STEPS,
      (s) => {
        ran.push(s.name);
        return s.name === 'b' ? bad : 0;
      },
      (m) => messages.push(m),
    );
    assert.equal(code, 1, `종료 코드 ${bad}`);
    assert.deepEqual(ran, ['a', 'b'], '실패한 단계 뒤는 돌지 않는다');
    assert.ok(
      messages.some((m) => m.includes('b')),
      '실패한 단계의 이름을 낸다',
    );
  }
});

test('실행하지 못한 단계(던진다)도 실패다', () => {
  const ran: string[] = [];
  const messages: string[] = [];
  const code = runSteps(
    STEPS,
    (s) => {
      ran.push(s.name);
      if (s.name === 'a') throw new Error('spawn 실패');
      return 0;
    },
    (m) => messages.push(m),
  );
  assert.equal(code, 1);
  assert.deepEqual(ran, ['a']);
  assert.ok(
    messages.some((m) => m.includes('a')),
    '실패한 단계의 이름을 낸다',
  );
});

test('spawnStep: 자식 프로세스의 종료 코드가 그대로 돌아온다(실제 실행)', () => {
  assert.equal(spawnStep({ name: 'zero', args: ['-e', 'process.exit(0)'] }, 'ignore'), 0);
  assert.equal(spawnStep({ name: 'three', args: ['-e', 'process.exit(3)'] }, 'ignore'), 3);
  // runSteps와 이으면: 0이 아닌 코드에서 멈춘다
  const ran: string[] = [];
  const code = runSteps(
    [
      { name: 'ok', args: ['-e', 'process.exit(0)'] },
      { name: 'bad', args: ['-e', 'process.exit(3)'] },
      { name: 'never', args: ['-e', 'process.exit(0)'] },
    ],
    (s) => {
      ran.push(s.name);
      return spawnStep(s, 'ignore');
    },
    () => {},
  );
  assert.equal(code, 1);
  assert.deepEqual(ran, ['ok', 'bad']);
});

test('명령: 잘못된 인자는 종료 코드 2이고, 표준 오류는 사용법 한 줄뿐이며, 아무 단계도 돌지 않는다', () => {
  // --out에 주는 경로는 리포 밖의 새 임시 폴더 아래다. 그 폴더가 빈 채인지 본다
  const out = mkdtempSync(path.join(os.tmpdir(), 'q10-run-test-'));
  for (const args of [['--bogus'], ['--out', path.join(out, 'x.json')], ['--out'], ['x']]) {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(r.status, 2, args.join(' '));
    assert.equal(r.stderr, '사용법: node lab/q10-db/run.ts [--skip-fmt]\n', args.join(' '));
    assert.equal(r.stdout, '', '단계를 시작하는 줄이 없다');
    assert.deepEqual(readdirSync(out), []);
  }
});

test('trial.ts의 인자 검사: 빈 폴더 하나만 받는다', () => {
  assert.deepEqual(parseTrialArgs(['some-dir']), { dir: 'some-dir' });
  assert.equal(TRIAL_USAGE, '사용법: node lab/q10-db/trial.ts <빈 폴더>');
  for (const argv of [
    [],
    ['--x'],
    ['some-dir', '--out', 'x.json'],
    ['some-dir', '더'],
    ['--out', 'x.json'],
    [''],
  ])
    assert.deepEqual(parseTrialArgs(argv), { error: TRIAL_USAGE }, JSON.stringify(argv));
});

test('trial.ts가 인자 검사를 가장 먼저 한다(글로 본다. trial.ts를 실행하지 않는다)', () => {
  const text = readFileSync(TRIAL, 'utf8');
  assert.match(text, /import \{ parseTrialArgs \} from '\.\/trial-args\.ts';/);
  assert.ok(!text.includes('--out'), 'trial.ts에 --out이 없다');
  const start = text.indexOf('async function main(');
  assert.ok(start >= 0);
  const main = text.slice(start);
  const call = main.indexOf('parseTrialArgs(');
  assert.ok(call >= 0, 'main이 parseTrialArgs를 부른다');
  // main의 첫 문장이다
  assert.match(main, /^async function main\(\): Promise<void> \{\n\s*const \w+ = parseTrialArgs\(/);
  // 폴더를 보거나 만들거나 자식 프로세스를 띄우는 호출보다 앞이다
  for (const fn of [
    'existsSync',
    'statSync',
    'readdirSync',
    'mkdirSync',
    'writeFileSync',
    'spawnSync',
  ]) {
    const at = main.search(new RegExp(`\\b${fn}\\(`));
    assert.ok(at < 0 || call < at, `${fn}보다 앞이다`);
  }
  // 거부하면 fail로 끝낸다(던지지 않는다)
  assert.match(main, /if \('error' in \w+\) fail\(\w+\.error\);/);
});
