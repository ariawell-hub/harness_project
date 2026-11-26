// 계획을 링크를 따라가지 않고 읽는다(scripts/lib/plan-read.ts, Issue #194)
import assert from 'node:assert/strict';
import { mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { runSync } from '../lib/exec.ts';
import {
  findPlanSafe,
  listPlanDir,
  planReader,
  PlanPathError,
  readPlanFile,
} from '../lib/plan-read.ts';
import { commitAll, gitInit, sh, tmp, write } from './helpers.ts';

const ID = '20261111-readdemo';
const DIR = `docs/exec-plans/active/${ID}`;

/** 계획 폴더(plan.md, step0.md)가 있는 git 리포. 리포 밖 폴더(outside)에도 같은 이름의 파일이 있다 */
function repo(): { root: string; outside: string } {
  const root = path.join(tmp(), 'repo');
  gitInit(root);
  write(root, `${DIR}/plan.md`, 'plan\n');
  write(root, `${DIR}/step0.md`, 'step\n');
  commitAll(root, 'plan');
  const outside = path.join(tmp(), 'outside');
  write(outside, 'plan.md', 'outside\n');
  write(outside, 'step0.md', 'outside\n');
  return { root, outside };
}

/** 파일 링크를 만든다. 권한이 없으면(개발자 모드가 꺼진 Windows) false */
function fileLink(target: string, at: string): boolean {
  try {
    symlinkSync(target, at, 'file');
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EPERM') throw e;
    return false;
  }
}

/** 던진 PlanPathError의 자리 */
function placeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof PlanPathError, `PlanPathError가 아니다: ${String(e)}`);
    assert.match(e.message, new RegExp(e.place.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    return e.place;
  }
  assert.fail('던지지 않았다');
}

/** 색인에 그 경로를 모드(120000·160000)로 올린다. 작업 트리는 건드리지 않는다 */
function indexAs(root: string, rel: string, mode: '120000' | '160000'): void {
  const sha =
    mode === '120000'
      ? runSync('git', ['hash-object', '-w', '--stdin'], {
          cwd: root,
          input: '/etc/passwd',
        }).stdout.trim()
      : sh('git', ['rev-parse', 'HEAD'], root);
  sh('git', ['update-index', '--add', '--cacheinfo', `${mode},${sha},${rel}`], root);
}

test('일반 파일·폴더는 글과 목록을, 없으면 null·[]를 돌려준다', () => {
  const { root } = repo();
  assert.equal(readPlanFile(root, `${DIR}/plan.md`), 'plan\n');
  assert.deepEqual(listPlanDir(root, DIR).sort(), ['plan.md', 'step0.md']);
  assert.equal(readPlanFile(root, `${DIR}/index.json`), null);
  assert.equal(readPlanFile(root, `docs/exec-plans/active/none/plan.md`), null);
  assert.deepEqual(listPlanDir(root, 'docs/exec-plans/active/none'), []);
  assert.deepEqual(findPlanSafe(root, ID), {
    id: ID,
    kind: 'multi',
    where: 'active',
    file: `${DIR}/plan.md`,
    dir: DIR,
  });
  assert.equal(findPlanSafe(root, '20261111-none'), null);
  // 소규모 계획(단일 파일)도 찾는다
  write(root, 'docs/exec-plans/completed/20261111-small.md', 'small\n');
  assert.equal(findPlanSafe(root, '20261111-small')?.kind, 'small');
});

test('파일 링크·폴더 링크·위 폴더 자리의 링크는 그 자리를 적어 던진다', () => {
  const a = repo();
  rmSync(path.join(a.root, DIR, 'plan.md'));
  if (fileLink(path.join(a.outside, 'plan.md'), path.join(a.root, DIR, 'plan.md'))) {
    assert.equal(
      placeOf(() => readPlanFile(a.root, `${DIR}/plan.md`)),
      `${DIR}/plan.md`,
    );
    assert.equal(
      placeOf(() => findPlanSafe(a.root, ID)),
      `${DIR}/plan.md`,
    );
  }
  const b = repo();
  rmSync(path.join(b.root, DIR), { recursive: true });
  symlinkSync(b.outside, path.join(b.root, DIR), 'junction');
  assert.equal(
    placeOf(() => readPlanFile(b.root, `${DIR}/plan.md`)),
    DIR,
  );
  assert.equal(
    placeOf(() => listPlanDir(b.root, DIR)),
    DIR,
  );
  assert.equal(
    placeOf(() => findPlanSafe(b.root, ID)),
    DIR,
  );
  // 위 폴더 자리(docs/exec-plans/active)의 링크
  const c = repo();
  const active = path.join(c.root, 'docs/exec-plans/active');
  const elsewhere = path.join(c.root, 'docs/exec-plans/elsewhere');
  renameSync(active, elsewhere);
  symlinkSync(elsewhere, active, 'junction');
  assert.equal(
    placeOf(() => readPlanFile(c.root, `${DIR}/plan.md`)),
    'docs/exec-plans/active',
  );
});

test('폴더 자리의 일반 파일, 파일 자리의 폴더는 던진다', () => {
  const a = repo();
  rmSync(path.join(a.root, DIR), { recursive: true });
  writeFileSync(path.join(a.root, DIR), 'not a dir\n');
  assert.equal(
    placeOf(() => readPlanFile(a.root, `${DIR}/plan.md`)),
    DIR,
  );
  const b = repo();
  rmSync(path.join(b.root, DIR, 'plan.md'));
  mkdirSync(path.join(b.root, DIR, 'plan.md'));
  assert.equal(
    placeOf(() => readPlanFile(b.root, `${DIR}/plan.md`)),
    `${DIR}/plan.md`,
  );
});

test('색인에 심볼릭 링크(120000)·서브모듈(160000)로 있는 자리는 작업 트리가 일반이어도 던진다', () => {
  for (const mode of ['120000', '160000'] as const) {
    // 파일 자리: 작업 트리는 일반 파일(core.symlinks=false로 받은 꼴)
    const a = repo();
    indexAs(a.root, `${DIR}/plan.md`, mode);
    assert.equal(
      placeOf(() => readPlanFile(a.root, `${DIR}/plan.md`)),
      `${DIR}/plan.md`,
      mode,
    );
    assert.equal(
      placeOf(() => findPlanSafe(a.root, ID)),
      `${DIR}/plan.md`,
      mode,
    );
    // 폴더 자리
    const b = repo();
    sh('git', ['rm', '-r', '-q', '--cached', DIR], b.root);
    indexAs(b.root, DIR, mode);
    assert.equal(
      placeOf(() => listPlanDir(b.root, DIR)),
      DIR,
      mode,
    );
  }
});

test('색인에만 링크로 있고 작업 트리에는 없는 자리도 던진다(뒤 후보로 넘어가지 않는다)', () => {
  const { root } = repo();
  rmSync(path.join(root, DIR, 'plan.md'));
  indexAs(root, `${DIR}/plan.md`, '120000');
  // 뒤 후보(소규모 계획 파일)가 있어도 그쪽으로 넘어가지 않는다
  write(root, `docs/exec-plans/active/${ID}.md`, 'small\n');
  assert.equal(
    placeOf(() => findPlanSafe(root, ID)),
    `${DIR}/plan.md`,
  );
  assert.equal(
    placeOf(() => readPlanFile(root, `${DIR}/plan.md`)),
    `${DIR}/plan.md`,
  );
});

test('폴더 바로 아래에 색인에만 링크로 있는 항목은 목록에 이름이 들어가고, 그 이름을 읽으면 던진다', () => {
  const { root } = repo();
  rmSync(path.join(root, DIR, 'step0.md'));
  indexAs(root, `${DIR}/step0.md`, '120000');
  indexAs(root, `${DIR}/refs/deep.md`, '120000');
  // 작업 트리에는 step0.md가 없지만 목록에는 있다(목록은 던지지 않는다). 더 깊은 항목은 바로 아래 이름이 아니다
  assert.deepEqual(listPlanDir(root, DIR).sort(), ['plan.md', 'step0.md']);
  assert.deepEqual(planReader(root).list(DIR).sort(), ['plan.md', 'step0.md']);
  assert.equal(
    placeOf(() => readPlanFile(root, `${DIR}/step0.md`)),
    `${DIR}/step0.md`,
  );
  // 그 항목을 지나지 않는 읽기는 그대로다
  assert.equal(readPlanFile(root, `${DIR}/plan.md`), 'plan\n');
});

test('리포 폴더 자체가 심볼릭 링크면 자리 "."를 적어 던진다(끝에 "/"가 붙어도)', () => {
  const { root } = repo();
  const link = path.join(tmp(), 'repo-link');
  symlinkSync(root, link, 'junction');
  assert.equal(
    placeOf(() => readPlanFile(link, `${DIR}/plan.md`)),
    '.',
  );
  assert.equal(
    placeOf(() => readPlanFile(`${link}/`, `${DIR}/plan.md`)),
    '.',
  );
  assert.equal(
    placeOf(() => findPlanSafe(link, ID)),
    '.',
  );
  assert.equal(
    placeOf(() => listPlanDir(link, DIR)),
    '.',
  );
  // 링크 대상의 색인이 깨져 있어도 git을 부르기 전에 리포 폴더 자체를 본다
  writeFileSync(path.join(root, '.git', 'index'), 'garbage');
  assert.equal(
    placeOf(() => planReader(link).read(`${DIR}/plan.md`)),
    '.',
  );
});

test('git 리포가 아닌 폴더에서는 lstat만으로 판정한다', () => {
  const root = tmp();
  write(root, `${DIR}/plan.md`, 'plan\n');
  assert.equal(readPlanFile(root, `${DIR}/plan.md`), 'plan\n');
  const outside = path.join(tmp(), 'o');
  write(outside, 'x.md', 'outside\n');
  if (fileLink(path.join(outside, 'x.md'), path.join(root, DIR, 'step0.md')))
    assert.equal(
      placeOf(() => readPlanFile(root, `${DIR}/step0.md`)),
      `${DIR}/step0.md`,
    );
});

test('색인 파일이 깨진 리포에서는 던진다(fail-closed)', () => {
  const { root } = repo();
  writeFileSync(path.join(root, '.git', 'index'), 'garbage');
  assert.throws(() => readPlanFile(root, `${DIR}/plan.md`), /색인을 읽지 못했다/);
});

test('planReader는 색인을 한 번만 읽고 여러 자리를 판정한다', () => {
  const { root } = repo();
  const r = planReader(root);
  assert.equal(r.read(`${DIR}/plan.md`), 'plan\n');
  // 읽기 객체를 만든 뒤 색인을 깨도 처음 읽은 색인으로 판정한다
  writeFileSync(path.join(root, '.git', 'index'), 'garbage');
  assert.equal(r.read(`${DIR}/step0.md`), 'step\n');
  assert.equal(r.find(ID)?.file, `${DIR}/plan.md`);
});
