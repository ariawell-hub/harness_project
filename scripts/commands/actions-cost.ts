// actions-cost: Actions 실행 기록에서 "비공개 리포였다면 청구됐을 값"을 계산해 표준 출력에 낸다(계획 20261121-actions-cost-design).
// GitHub은 읽기만 한다. 순서가 규칙이다: 인자·기간 검사 → 자료 읽기 → (--save) 보존 기록 쓰기 → 계산·렌더 → 출력.
// 자료를 다 읽지 못하면 아무것도 내지 않는다(종료 코드 2). --save를 주지 않으면 파일을 쓰지 않는다.
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  linkSync,
  lstatSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { repoInfo } from '../lib/git.ts';
import {
  actionsCost,
  formatSaved,
  fromSaved,
  knownNamesFrom,
  parseSaved,
  renderCost,
  toSaved,
  type JobRecord,
  type KnownNames,
  type SavedJob,
} from '../metrics/actions-cost.ts';
import { ghActionsSource, type ActionsSource } from '../metrics/actions-source.ts';
import { parsePeriod, type Period } from '../metrics/source.ts';

export interface ActionsCostOptions {
  since?: string;
  until?: string;
  /** 읽은 기록을 보존 기록으로 남길 파일 */
  save?: string;
  /** GitHub 대신 읽을 보존 기록 파일 */
  from?: string;
  /** 테스트용. 주지 않으면 리포 루트의 `.github/workflows/*.yml`·`*.yaml`을 읽어 `knownNamesFrom`으로 만든다 */
  known?: KnownNames;
  now?: Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

const first = (e: unknown) => (e instanceof Error ? e.message : String(e)).split('\n')[0];

/** 명령을 실행한 체크아웃의 워크플로 파일에서 허용 목록을 만든다(실행 기록에서 만들지 않는다) */
function knownFromCheckout(root: string): KnownNames {
  const dir = path.join(root, '.github', 'workflows');
  if (!existsSync(dir)) return new Map();
  return knownNamesFrom(
    readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((name) => ({ name, text: readFileSync(path.join(dir, name), 'utf8') })),
  );
}

const exists = (file: string) => {
  try {
    lstatSync(file);
    return true;
  } catch {
    return false;
  }
};

/**
 * 보존 기록을 대상 경로에 놓는다. 대상이 이미 있으면 실패한다(덮어쓰지 않는다).
 * 같은 폴더의 임시 파일에 다 쓴 뒤 하드 링크를 건다: 대상이 있으면 운영체제가 거부하고,
 * 쓰다 만 파일이 대상 이름으로 보이는 일이 없다. 이름 바꾸기는 대상을 덮어쓰므로 쓰지 않는다
 */
function placeNew(target: string, text: string): void {
  const tmp = `${target}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    writeFileSync(tmp, text, { flag: 'wx' });
    linkSync(tmp, target);
  } finally {
    rmSync(tmp, { force: true });
  }
}

export function runActionsCost(cwd: string, o: ActionsCostOptions, source?: ActionsSource): number {
  const out = o.out ?? ((l: string) => process.stdout.write(`${l}\n`));
  const err = o.err ?? ((l: string) => process.stderr.write(`${l}\n`));

  // ① 인자와 기간. GitHub과 보존 기록을 읽기 전에 본다
  if (
    o.from !== undefined &&
    (o.since !== undefined || o.until !== undefined || o.save !== undefined)
  ) {
    err(
      'actions-cost: --from은 --since·--until·--save와 함께 쓸 수 없다. 기간은 보존 기록의 것이고, 보존 기록을 다시 남기지 않는다',
    );
    return 1;
  }
  let period: Period | null = null;
  if (o.from === undefined) {
    try {
      period = parsePeriod(o.since, o.until, o.now ?? new Date());
    } catch (e) {
      err(`actions-cost: ${first(e)}. 날짜는 UTC 기준 YYYY-MM-DD로 준다(예: --since 2026-11-17)`);
      return 1;
    }
  }
  const saveTo = o.save === undefined ? null : path.resolve(cwd, o.save);
  if (saveTo !== null) {
    if (exists(saveTo)) {
      err(
        `actions-cost: --save 파일이 이미 있다. 덮어쓰지 않는다(남긴 기록이 기준이다). 다른 이름을 주거나, 그 파일로 계산하려면 --from을 써라`,
      );
      return 1;
    }
    const dir = path.dirname(saveTo);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) {
      err('actions-cost: --save 파일을 둘 폴더가 없다. 폴더를 먼저 만들어라');
      return 1;
    }
  }

  // ② 자료 읽기. 다 읽지 못하면 값을 내지 않는다
  let known: KnownNames;
  let jobs: JobRecord[];
  let saved: SavedJob[];
  try {
    // 리포 루트는 필요할 때만 찾는다(허용 목록과 자료 원천을 둘 다 받은 테스트는 리포 밖에서 돈다)
    const root = () => repoInfo(cwd).root;
    known = o.known ?? knownFromCheckout(root());
    if (o.from !== undefined) {
      const file = parseSaved(readFileSync(path.resolve(cwd, o.from), 'utf8'));
      period = file.period;
      saved = file.jobs;
    } else {
      const src = source ?? ghActionsSource({ cwd: root(), progress: err });
      saved = toSaved(src.jobs(period!), known);
    }
    // 계산은 보존 기록의 꼴을 거친 입력으로 한다. --save로 낸 출력과 그 파일을 --from으로 낸 출력이 같다
    jobs = fromSaved(saved);
  } catch (e) {
    const what = o.from !== undefined ? '보존 기록을 읽지 못했다' : '자료를 끝까지 읽지 못했다';
    err(`actions-cost: ${what}. 값을 내지 않는다 — ${first(e)}`);
    return 2;
  }

  // ③ 보존 기록 쓰기. 놓지 못하면 값도 내지 않는다(출력과 남은 파일이 다른 기록을 가리키면 안 된다)
  if (saveTo !== null) {
    try {
      placeNew(saveTo, formatSaved(saved, period!));
    } catch (e) {
      const what =
        (e as NodeJS.ErrnoException | null)?.code === 'EEXIST'
          ? '읽는 사이에 --save 파일이 생겼다. 덮어쓰지 않았다(먼저 남긴 기록이 기준이다)'
          : '보존 기록을 쓰지 못했다';
      err(`actions-cost: ${what}. 값을 내지 않는다 — ${first(e)}`);
      return 2;
    }
  }

  // ④ 계산·렌더 → ⑤ 출력
  out(renderCost(actionsCost(jobs, period!, known), period!).trimEnd());
  return 0;
}
