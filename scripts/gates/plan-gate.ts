// plan-gate (R1, G1, 10.3절): 계획 파일·필수 섹션·size·risk·step 상태·자기 step AC 불변·발견 사항 처리.
// 중·대 규모의 G1(계획 교차 검증 확인)은 호출자가 넘긴 해시와 원장의 계획 승인으로 판정한다. planReview.required로 켠다.
// CI에서는 main의 이 스크립트가 PR head 체크아웃(pr/)을 데이터로만 읽는다. PR 코드를 실행하지 않는다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { HarnessConfig } from '../lib/config.ts';
import { showFile } from '../lib/git.ts';
import {
  PLAN_STATUSES,
  RISKS,
  SIZES,
  STEP_STATUSES,
  extractCommands,
  findPlan,
  findPlanAt,
  hashText,
  isBlank,
  parseBranch,
  parseDoc,
  parseIndex,
  section,
  smallPlanFields,
  stepFile,
  unhandledFindings,
  type PlanRef,
  type StepIndex,
} from '../lib/plan.ts';
import type { Problem } from '../lib/util.ts';

const DOC = 'docs/harness/design.md R1, 8절 / docs/harness/workflow.md';
const P = (what: string, how: string): Problem => ({ rule: 'R1 plan-gate', what, how, doc: DOC });

/** G1 판정 자료(4.1·10.3절). 해시는 ci/plan-hash.ts가 계산하고 호출자(ci/gates.ts, CLI)가 넘긴다 */
export interface PlanG1 {
  /** 지금 계획의 핵심 섹션 해시 */
  hash: string;
  /** merge-base에 있는 같은 계획의 해시. 계획이 없었으면 null */
  baseHash: string | null;
  /**
   * 원장(검증 App 봇 댓글)의 계획 승인. 승인 기록이 없으면 null.
   * 원장을 보지 않는 실행(로컬)은 이 값을 주지 않는다(undefined)
   */
  review?: { hash: string; approvals: readonly string[] } | null;
  /** 계획 승인에 필요한 검증자 */
  reviewers: readonly string[];
}

export interface PlanGateOptions {
  root: string;
  base: string | null;
  branch: string;
  /** pr: PR 병합 판정, plan: 계획 작성 직후 구조 검사(runner) */
  mode: 'pr' | 'plan';
  cfg: HarnessConfig;
  /** 없으면 G1을 확인하지 않고 참고만 남긴다(runner 등). 최종 판정은 CI의 plan-gate다 */
  g1?: PlanG1;
}

export interface PlanGateResult {
  problems: Problem[];
  notes: string[];
  plan: PlanRef | null;
}

const PLAN_ONLY_HOW =
  '계획만 담은 커밋(코드 변경 없음)을 push해 필요한 검증자의 승인을 받아라. 코드를 이미 올렸으면 되돌리는 커밋으로 계획만 남긴다(절차서 2절)';

/**
 * G1: (a) merge-base의 같은 계획과 해시가 같으면 통과, (b) 원장의 계획 승인이 지금 해시의 것이고
 * 필요한 검증자가 모두 승인했으면 통과, (c) 그 밖은 실패. 원장을 보지 않은 실행은 판정하지 않는다(ok: null)
 */
function checkG1(g: PlanG1 | undefined): { ok: boolean | null; what: string; how: string } {
  if (!g)
    return {
      ok: null,
      what: 'G1: 계획 승인은 이 실행에서 확인하지 않았다(CI의 plan-gate가 원장으로 확인한다)',
      how: '',
    };
  const short = g.hash.slice(0, 12);
  if (g.baseHash === g.hash) return { ok: true, what: '', how: '' };
  if (g.review === undefined)
    return {
      ok: null,
      what: `G1: 계획 핵심 섹션이 base와 다르다(해시 ${short}). 병합하려면 계획만 담은 커밋에서 검증자 승인을 받아야 한다(CI가 원장으로 확인한다)`,
      how: '',
    };
  if (!g.review)
    return {
      ok: false,
      what: `G1: 중·대 규모 계획이 교차 검증 승인을 받지 않았다(해시 ${short})`,
      how: PLAN_ONLY_HOW,
    };
  if (g.review.hash !== g.hash)
    return {
      ok: false,
      what: `G1: 승인받은 뒤 계획 핵심 섹션이 바뀌었다(승인 ${g.review.hash.slice(0, 12)}, 지금 ${short})`,
      how: `목표·수용 기준, 범위, 관련 파일, step의 작업·AC를 바꿨으면 다시 검증받는다. ${PLAN_ONLY_HOW}`,
    };
  const approvals = g.review.approvals;
  const missing = g.reviewers.filter((r) => !approvals.includes(r));
  if (missing.length)
    return {
      ok: false,
      what: `G1: 계획 승인이 부족하다(해시 ${short}): ${missing.join(', ')} 미승인`,
      how: '계획만 담은 커밋의 판정에서 남은 검증자의 승인을 받아라(지적은 원장과 기록 job 로그에 있다)',
    };
  return {
    ok: true,
    what: `G1: 계획 승인 확인(해시 ${short}, ${g.reviewers.join('·')})`,
    how: '',
  };
}

function read(root: string, rel: string): string | null {
  const f = path.join(root, rel);
  return existsSync(f) ? readFileSync(f, 'utf8') : null;
}

export function planGate(o: PlanGateOptions): PlanGateResult {
  const problems: Problem[] = [];
  const notes: string[] = [];
  const b = parseBranch(o.branch);
  if (!b) {
    problems.push(
      P(
        `브랜치 이름 ${o.branch}가 <type>/<계획 id>-s<N> 규칙과 다르다`,
        '`node scripts/harness.ts new-task`로 브랜치·worktree·계획을 함께 만들어라',
      ),
    );
    return { problems, notes, plan: null };
  }
  const ref = findPlan(o.root, b.id);
  if (!ref) {
    problems.push(
      P(
        `계획 파일이 없다: docs/exec-plans/{active,completed}/${b.id}(.md|/plan.md)`,
        '코드를 고치기 전에 계획을 작성하라. new-task가 골격을 만든다',
      ),
    );
    return { problems, notes, plan: null };
  }
  if ((b.step === null) !== (ref.kind === 'small')) {
    problems.push(
      P(
        `브랜치(${o.branch})와 계획 형태(${ref.kind === 'small' ? '소규모 단일 파일' : 'step 폴더'})가 맞지 않다`,
        '소규모는 <type>/<id>, 중·대 규모는 <type>/<id>-s<N> 브랜치를 쓴다',
      ),
    );
    return { problems, notes, plan: ref };
  }
  const text = read(o.root, ref.file)!;
  const doc = parseDoc(text);
  const fm = doc.frontmatter;
  if (!fm) {
    problems.push(
      P(
        `${ref.file}에 frontmatter가 없다`,
        '템플릿(docs/exec-plans/TEMPLATE*.md)의 frontmatter를 채워라',
      ),
    );
    return { problems, notes, plan: ref };
  }
  if (fm.id !== b.id)
    problems.push(
      P(`frontmatter id(${fm.id})가 계획 id(${b.id})와 다르다`, 'id를 파일·브랜치 이름과 맞춰라'),
    );
  if (!(typeof fm.issue === 'number' && fm.issue > 0))
    problems.push(
      P('frontmatter issue가 GitHub Issue 번호가 아니다', 'issue: 42 처럼 숫자로 적어라'),
    );
  if (!SIZES.includes(fm.size as never))
    problems.push(
      P(
        `size가 ${SIZES.join('|')} 중 하나가 아니다`,
        '4.3절 기준으로 size를 정하라. 애매하면 큰 쪽',
      ),
    );
  if (!RISKS.includes(fm.risk as never))
    problems.push(P(`risk가 ${RISKS.join('|')} 중 하나가 아니다`, '10.1절 기준으로 risk를 정하라'));
  if (!PLAN_STATUSES.includes(fm.status as never))
    problems.push(P(`status가 ${PLAN_STATUSES.join('|')} 중 하나가 아니다`, 'status 값을 고쳐라'));
  if (ref.kind === 'small' && fm.size !== 'small')
    problems.push(
      P(
        '단일 파일 계획인데 size가 small이 아니다',
        '중·대 규모는 plan.md + index.json + stepN.md 폴더 형식을 써라',
      ),
    );
  if (ref.kind === 'multi' && fm.size === 'small')
    problems.push(
      P('step 폴더 계획인데 size가 small이다', '소규모는 단일 파일 경량 템플릿을 써라'),
    );

  let index: StepIndex | null = null;
  if (ref.kind === 'small') {
    const f = smallPlanFields(doc.body);
    for (const k of ['목표', '변경', '검증'] as const) {
      if (!f[k])
        problems.push(
          P(
            `소규모 계획의 "- ${k}:" 줄이 비어 있다`,
            `"- ${k}: ..."를 한 줄로 채워라. 검증은 runner가 실행할 명령이다`,
          ),
        );
    }
  } else {
    for (const s of ['목표와 수용 기준', '범위', '검증 방법']) {
      if (isBlank(section(doc.body, s)))
        problems.push(P(`필수 섹션 "## ${s}"가 비어 있다`, '섹션을 채워라(8.2절 템플릿)'));
    }
    const idxText = read(o.root, `${ref.dir}/index.json`);
    if (!idxText)
      problems.push(P(`${ref.dir}/index.json이 없다`, 'step 목록을 index.json에 적어라'));
    else {
      try {
        index = parseIndex(idxText);
      } catch (e) {
        problems.push(P(`index.json 형식 오류: ${(e as Error).message}`, '8.2절 형식을 따르라'));
      }
    }
    if (index) {
      if (index.plan !== b.id)
        problems.push(P(`index.json plan(${index.plan})이 계획 id와 다르다`, 'plan 값을 고쳐라'));
      if (index.steps.length === 0)
        problems.push(P('index.json에 step이 하나도 없다', '계획을 step으로 나눠 적어라'));
      index.steps.forEach((s, i) => {
        if (s.step !== i)
          problems.push(
            P(
              `index.json의 step 번호가 0부터 연속이 아니다(${i}번째가 ${s.step})`,
              'step을 0,1,2… 순서로 적어라',
            ),
          );
        if (!STEP_STATUSES.includes(s.status))
          problems.push(
            P(`step${i} status가 ${STEP_STATUSES.join('|')}가 아니다`, 'status 값을 고쳐라'),
          );
        if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.name ?? ''))
          problems.push(
            P(`step${i} 이름(${s.name})이 kebab-case가 아니다`, '한두 단어 kebab-case로 지어라'),
          );
        const sf = read(o.root, stepFile(ref, i));
        if (!sf) {
          problems.push(
            P(`${stepFile(ref, i)}가 없다`, 'TEMPLATE-step.md로 step 지시서를 만들어라'),
          );
          return;
        }
        if (isBlank(section(sf, '작업')))
          problems.push(P(`${stepFile(ref, i)}의 "## 작업"이 비어 있다`, '구체 지시를 적어라'));
        if (extractCommands(section(sf, 'Acceptance Criteria')).length === 0) {
          problems.push(
            P(
              `${stepFile(ref, i)}의 Acceptance Criteria에 실행할 명령이 없다`,
              '```bash 블록에 runner가 실행할 명령을 적어라(8.2절 원칙 5)',
            ),
          );
        }
      });
    }
  }

  if (o.mode === 'plan') {
    if (fm.status !== 'draft' && fm.status !== 'active')
      problems.push(
        P(`계획 작성 단계인데 status가 ${fm.status}이다`, 'status를 draft 또는 active로 두어라'),
      );
    return { problems, notes, plan: ref };
  }

  // ---- PR 모드: 이 PR이 맡은 step의 완료 처리 (8.3절) ----
  if (ref.kind === 'small') {
    if (fm.status !== 'completed' || ref.where !== 'completed') {
      problems.push(
        P(
          '소규모 계획이 완료 처리되지 않았다',
          '`node scripts/harness.ts complete-step`으로 계획 전용 커밋을 만들어라',
        ),
      );
    }
  } else if (index && b.step !== null) {
    const entry = index.steps[b.step];
    const last = b.step === index.steps.length - 1;
    if (!entry)
      problems.push(
        P(`이 PR의 step${b.step}이 index.json에 없다`, 'index.json과 브랜치 번호를 맞춰라'),
      );
    else if (entry.status !== 'completed')
      problems.push(
        P(
          `이 PR의 step${b.step} 상태가 ${entry.status}이다(완료 처리 전)`,
          '`node scripts/harness.ts complete-step`으로 계획 전용 커밋을 만들어라',
        ),
      );
    if (last && (fm.status !== 'completed' || ref.where !== 'completed')) {
      problems.push(
        P(
          '마지막 step인데 계획이 completed/로 옮겨지지 않았다',
          'complete-step이 마지막 step에서 계획을 completed/로 옮긴다',
        ),
      );
    }
    if (!last && ref.where !== 'active')
      problems.push(P('남은 step이 있는데 계획이 completed/에 있다', '계획을 active/로 되돌려라'));
  }

  // 자기 step 파일의 작업·AC는 바꿀 수 없다 (8.2절)
  if (o.base && ref.kind === 'multi' && b.step !== null) {
    const readBase = (f: string) => showFile(o.root, o.base!, f);
    const baseRef = findPlanAt(readBase, b.id);
    if (baseRef?.dir) {
      for (let i = 0; i < (index?.steps.length ?? 0); i++) {
        const baseText = readBase(stepFile(baseRef, i));
        const headText = read(o.root, stepFile(ref, i));
        if (baseText === null || headText === null) {
          if (baseText === null && i <= b.step && b.step > 0)
            notes.push(`step${i} 파일이 base에 없다: 계획 수정으로 본다(2단계에서 G1 재검증 대상)`);
          continue;
        }
        const changed = ['작업', 'Acceptance Criteria'].filter(
          (s) => hashText(section(baseText, s) ?? '') !== hashText(section(headText, s) ?? ''),
        );
        if (!changed.length) continue;
        if (i === b.step) {
          problems.push(
            P(
              `이 PR이 실행하는 step${i}의 ${changed.join('·')} 섹션을 바꿨다`,
              'step의 작업·AC는 실행 PR에서 바꿀 수 없다. 계획을 고쳐야 하면 별도 계획 수정으로 처리하라(G1)',
            ),
          );
        } else {
          notes.push(
            `step${i}의 ${changed.join('·')}가 바뀌었다: 계획 수정(2단계에서 G1 재검증 대상)`,
          );
        }
      }
    }
  }

  const bad = unhandledFindings(doc.body);
  if (bad.length) {
    problems.push(
      P(
        `발견 사항 ${bad.length}건에 처리가 없다: ${bad.slice(0, 3).join(' / ')}`,
        '각 항목 끝에 "→ 처리: [문서](경로) | #Issue | TD-N | 해당 없음"을 적어라',
      ),
    );
  }

  // G1(4.1절): 중·대 규모 계획의 교차 검증 확인. 꺼져 있어도 자료가 오면 결과를 참고로 남긴다(켜기 전 실제 PR 확인용)
  const enforce = o.cfg.planReview.required;
  if (ref.kind === 'multi' && fm.size !== 'small' && (enforce || o.g1)) {
    const g = checkG1(o.g1);
    if (g.ok === false && enforce) problems.push({ ...P(g.what, g.how), rule: 'G1 plan-gate' });
    else if (g.what) notes.push(enforce ? g.what : g.what.replace(/^G1/, 'G1(꺼짐)'));
  }
  return { problems, notes, plan: ref };
}
