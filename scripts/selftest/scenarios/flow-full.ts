// 전체 흐름: 선점 → 계획만 담은 초안 PR → 계획 승인 → step → PR → 필수 체크 → 자동 병합 → Issue 닫힘.
// 그리고 승인 이어받기(10.3절): main 병합으로 갱신한 head는 앞선 승인을 이어받고, PR 파일을 공백만 바꾼 head는
// 이어받지 않는가(설계서 12.4절).
// 가짜 GitHub 상태 파일에 CI가 남길 것(체크, 원장 댓글)을 직접 넣는다. 그 파일의 형식과 원장 댓글 형식(v1)에 기댄다.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertAllowed, runnerConfig, type Scenario } from '../run.ts';

/** GitHub Actions 앱의 id. `source: actions`인 필수 체크는 이 앱이 만든 check run이어야 한다 */
const ACTIONS_APP_ID = 15368;
const REPO = 'selftest/sample';

interface Required {
  context: string;
  source: 'actions' | 'recorder';
}
interface Pr {
  number: number;
  head: string;
  state: string;
  isDraft: boolean;
  autoMerge: boolean;
  title: string;
  body: string;
}
interface State {
  issues: { number: number; state: string }[];
  prs: Pr[];
}

export default {
  id: 'flow-full',
  covers: '전체 흐름',
  title:
    '선점 → 계획 초안 PR → 계획 승인 → step → 필수 체크 → 자동 병합 → Issue 닫힘, 승인은 main 병합 갱신에서만 이어받는다',
  timeoutSec: 300,
  async run(ctx) {
    const s = ctx.sample({
      config: runnerConfig(ctx.harness, { planReview: { required: true } }),
    });
    const dir = path.dirname(s.root);
    const cfg = JSON.parse(readFileSync(path.join(s.root, 'harness.config.json'), 'utf8')) as {
      ci?: { requiredChecks?: Required[]; recorderBot?: string };
    };
    const required = cfg.ci?.requiredChecks ?? [];
    const recorder = cfg.ci?.recorderBot ?? '';
    assert.ok(
      required.length > 0 && recorder,
      '대상 하네스의 설정에 필수 체크와 검증 App 봇이 없다',
    );

    const gh = ctx.github(s);
    const state = () => gh.read() as State;
    // 브랜치 보호 흉내: 필수 체크가 정해진 출처의 success일 때만 병합한다
    gh.update((st) => {
      st.mergeRequires = required.map((r) =>
        r.source === 'actions'
          ? { context: r.context, kind: 'check-run', appId: ACTIONS_APP_ID }
          : { context: r.context, kind: 'status', creator: recorder },
      );
    });
    let clock = Date.now();
    /** CI가 그 커밋에 남기는 필수 체크 결과 */
    const setChecks = (sha: string, over: Record<string, string> = {}) =>
      gh.update((st) => {
        st.checks ??= {};
        const list = (st.checks[sha] ??= []);
        for (const r of required)
          list.push({
            context: r.context,
            kind: r.source === 'actions' ? 'check-run' : 'status',
            state: over[r.context] ?? 'success',
            description: '',
            creator: r.source === 'actions' ? '' : recorder,
            appId: r.source === 'actions' ? ACTIONS_APP_ID : null,
            targetUrl: '',
            at: new Date(++clock).toISOString(),
          });
      });
    const runner = () =>
      assertAllowed(
        ctx.cli(s, [
          'run',
          '--worker',
          'selftest-1',
          '--tool',
          'fake',
          '--no-wait',
          '--max-iterations',
          '40',
        ]),
        'runner',
      );
    const stepSessions = () => s.prompts().filter((p) => p.step !== 'plan').length;
    const remoteHead = (branch: string) => {
      s.git(['fetch', '-q', 'origin']);
      return s.git(['rev-parse', `origin/${branch}`]);
    };

    // 1) 선점과 계획: 계획만 담은 커밋의 초안 PR
    const issue = s.issue('Demo feature', { body: '데모 기능을 만든다' });
    ctx.agent(s, { 'demo-feature': { steps: 1 } });
    runner();
    assert.match(
      s.git(['ls-remote', '--heads', 'origin']),
      new RegExp(`refs/heads/claim/${issue}$`, 'm'),
      '선점 브랜치(claim/<N>)가 원격에 없다',
    );
    assert.equal(state().prs.length, 1, '계획 작성 뒤 초안 PR이 하나 있어야 한다');
    const pr = () => state().prs[0];
    const branch = pr().head;
    assert.equal(pr().isDraft, true, '계획 검증 중인 PR은 초안이어야 한다');
    assert.equal(pr().autoMerge, false, '계획 검증 중에는 자동 병합을 켜지 않는다');
    // step이 하나뿐인 계획이라 이 PR이 마지막 step이다
    assert.match(pr().body, new RegExp(`^Closes #${issue}\\b`));
    const planHead = remoteHead(branch);
    const planFiles = s.git(['diff', '--name-only', `origin/main...origin/${branch}`]).split('\n');
    const planDir = path.posix.dirname(planFiles.find((f) => f.endsWith('/plan.md')) ?? '');
    assert.match(planDir, /^docs\/exec-plans\/active\/[^/]+$/, '초안 PR에 계획 파일이 없다');
    assert.ok(
      planFiles.every((f) => f.startsWith(`${planDir}/`)),
      `계획만 담은 커밋이 아니다: ${planFiles.join(', ')}`,
    );
    assert.equal(stepSessions(), 0, '계획 승인 전에 step 세션을 띄웠다');

    // CI의 체크아웃 흉내: 원격을 새로 받아 PR head를 꺼낸 곳에서 CI 명령을 돌린다(runner의 worktree를 건드리지 않는다)
    const ci = path.join(dir, 'ci');
    s.git(['clone', '-q', s.remote, ci], dir);
    let outN = 0;
    /** mainRef: 그때의 main(PR의 base 브랜치 끝) */
    const reviewPlan = (mainRef: string, extra: string[], env: NodeJS.ProcessEnv = {}) => {
      const out = path.join(dir, `review-plan-${outN++}.out`);
      writeFileSync(out, '');
      const base = s.git(['merge-base', mainRef, 'HEAD'], ci);
      const r = ctx.cli(
        s,
        ['review-plan', '--repo', '.', '--config-root', s.root, '--base', base, ...extra],
        { cwd: ci, env: { GITHUB_OUTPUT: out, ...env } },
      );
      assertAllowed(r, 'review-plan');
      return Object.fromEntries(
        readFileSync(out, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
      ) as Record<string, string>;
    };
    s.git(['checkout', '-q', '--detach', planHead], ci);
    const plan = reviewPlan('origin/main', ['--head-ref', branch]);
    assert.equal(plan.mode, 'plan', '계획만 바꾼 PR을 계획 검증 대상으로 보지 않았다');
    assert.match(plan.plan_hash ?? '', /^[0-9a-f]{12,}$/, '계획 해시가 없다');

    // 2) CI는 끝났지만 원장에 계획 승인이 없다: step을 시작하지 않는다
    setChecks(planHead, { 'plan-gate': 'failure' });
    runner();
    assert.equal(stepSessions(), 0, '원장에 계획 승인이 없는데 step 세션을 띄웠다');

    // 3) 검증 App 봇의 원장에 계획 승인(지금 해시, 두 검증자)이 생기면 step을 진행한다
    const ledger = {
      version: 1,
      promptBase: planHead,
      rounds: [],
      findings: [],
      ciFailures: [],
      dropped: 0,
      planReview: { hash: plan.plan_hash, head: planHead, approvals: ['claude', 'codex'] },
    };
    const data = Buffer.from(JSON.stringify(ledger), 'utf8').toString('base64');
    gh.update((st) => {
      // PR의 댓글은 같은 번호의 Issue 항목에 둔다(가짜 GitHub의 형식)
      st.issues.push({
        number: pr().number,
        title: pr().title,
        body: pr().body,
        labels: [],
        state: 'closed',
        createdAt: '',
        author: '',
        comments: [
          {
            author: recorder,
            body: `<!-- harness-ledger:v1 -->\n## 지적 원장\n\n<!-- harness-ledger-data:${data} -->`,
            createdAt: new Date(++clock).toISOString(),
          },
        ],
      });
    });
    runner();
    assert.equal(stepSessions(), 1, '계획 승인 뒤 step 세션이 한 번 돌아야 한다');
    assert.equal(state().prs.length, 1, '구현은 계획을 올린 PR에 이어서 올려야 한다');
    assert.equal(pr().isDraft, false, 'step이 끝났는데 초안을 해제하지 않았다');
    assert.equal(pr().autoMerge, true, 'step이 끝났는데 자동 병합을 켜지 않았다');
    assert.equal(pr().state, 'open', '필수 체크가 없는 head가 병합됐다');
    const head = remoteHead(branch);
    assert.notEqual(head, planHead);
    const tree = s.git(['ls-tree', '-r', '--name-only', head]).split('\n');
    assert.ok(tree.includes('out/demo-feature-s0.txt'), 'PR head에 step의 산출물이 없다');
    const index = tree.find((f) => f.endsWith(`${path.posix.basename(planDir)}/index.json`));
    assert.ok(index, 'PR head에 계획의 index.json이 없다');
    const steps = (
      JSON.parse(s.git(['show', `${head}:${index}`])) as { steps: { status: string }[] }
    ).steps;
    assert.equal(
      steps[0].status,
      'completed',
      'PR head에 계획 완료 커밋이 없다(step이 completed가 아니다)',
    );

    // 4) 승인 이어받기(10.3절). review-plan이 PR의 커밋과 커밋 상태를 API로 조회한다
    const prPath = `repos/${REPO}/pulls/${pr().number}/commits`;
    const statusPath = (sha: string) => `repos/${REPO}/commits/${sha}/statuses`;
    const routes: Record<string, unknown> = {
      [prPath]: [{ sha: planHead }, { sha: head }],
      [statusPath(planHead)]: [],
      [statusPath(head)]: [],
    };
    const api = await ctx.api(s, routes);
    const carry = (headRef: string) => {
      const baseSha = s.git(['rev-parse', 'main-next'], ci);
      return reviewPlan(
        'main-next',
        ['--head-ref', headRef, '--pr-number', String(pr().number), '--base-sha', baseSha],
        { GITHUB_API_URL: api.url, GITHUB_REPOSITORY: REPO, GH_TOKEN: 'selftest' },
      );
    };
    const addHead = (sha: string) => {
      (routes[prPath] as { sha: string }[]).push({ sha });
      routes[statusPath(sha)] = [];
      api.set(routes);
    };
    s.git(['fetch', '-q', 'origin'], ci);
    s.git(['checkout', '-q', '--detach', head], ci);
    s.git(['branch', '-q', 'main-next', 'origin/main'], ci);
    const first = carry(branch);
    assert.match(first.patch ?? '', /^[0-9a-f]{40}$/, 'PR head의 patch-id를 재지 못했다');
    assert.equal(first.mode, 'code');
    assert.deepEqual(
      [first.claude, first.codex, first.carry_claude, first.carry_codex],
      ['true', 'true', '', ''],
      '승인이 없는 head: 두 검증자가 모두 필요하고 이어받을 것이 없어야 한다',
    );
    // 두 검증자가 이 head를 승인했다(검증 App 봇의 커밋 상태, patch 포함)
    routes[statusPath(head)] = ['review/claude', 'review/codex'].map((context) => ({
      context,
      state: 'success',
      description: `승인 patch:${first.patch}`,
      creator: { login: recorder },
    }));
    api.set(routes);
    // main이 PR과 겹치지 않는 파일로 앞서 나가고, PR을 main 병합으로 갱신한다
    s.git(['checkout', '-q', 'main-next'], ci);
    s.write('other.txt', 'main의 다른 변경\n', ci);
    s.git(['add', '-A'], ci);
    s.git(['commit', '-q', '-m', 'feat: 다른 변경'], ci);
    s.git(['checkout', '-q', '--detach', head], ci);
    s.git(['merge', '-q', '--no-edit', 'main-next'], ci);
    const updated = s.git(['rev-parse', 'HEAD'], ci);
    addHead(updated);
    const afterMerge = carry(branch);
    assert.deepEqual(
      [afterMerge.patch, afterMerge.carry_claude, afterMerge.carry_codex],
      [first.patch, head, head],
      'main 병합으로 갱신한 head가 앞선 승인을 이어받지 않았다',
    );
    // PR 파일을 공백만 바꾼 커밋: patch-id는 같지만 내용이 달라 이어받지 않는다
    s.write('out/demo-feature-s0.txt', 'step  0\n', ci);
    s.git(['add', '-A'], ci);
    s.git(['commit', '-q', '-m', 'style: 공백'], ci);
    addHead(s.git(['rev-parse', 'HEAD'], ci));
    const afterSpace = carry(branch);
    assert.equal(
      afterSpace.patch,
      first.patch,
      '공백만 바꾼 커밋의 patch-id가 달라졌다(이 확인의 전제)',
    );
    assert.deepEqual(
      [afterSpace.carry_claude, afterSpace.carry_codex],
      ['', ''],
      'PR 파일을 공백만 바꾼 head가 앞선 승인을 이어받았다',
    );
    assert.ok(
      api.hits().includes(`GET ${statusPath(head)}`),
      'review-plan이 승인된 head의 커밋 상태를 조회하지 않았다',
    );

    // 5) PR head의 필수 체크(검증 승인 포함)가 모두 통과하면 병합되고 Issue가 닫힌다.
    //    가짜 GitHub은 자동 병합을 켤 때 병합 조건을 본다. 체크를 넣은 뒤 자동 병합 표시를 꺼서 runner가 다시 켜게 한다
    setChecks(head);
    gh.update((st) => {
      st.prs[0].autoMerge = false;
    });
    runner();
    assert.equal(pr().state, 'merged', '필수 체크가 모두 통과한 PR이 병합되지 않았다');
    assert.equal(
      state().issues.find((i) => i.number === issue)!.state,
      'closed',
      '마지막 step의 PR이 병합됐는데 Issue가 닫히지 않았다',
    );
    s.git(['fetch', '-q', '--prune', 'origin']);
    const main = s.git(['ls-tree', '-r', '--name-only', 'origin/main']).split('\n');
    assert.ok(main.includes('out/demo-feature-s0.txt'), 'main에 step의 산출물이 없다');
    assert.ok(
      main.includes(`docs/exec-plans/completed/${path.posix.basename(planDir)}/plan.md`),
      'main에 완료된 계획이 없다',
    );
    assert.doesNotMatch(
      s.git(['ls-remote', '--heads', 'origin']),
      new RegExp(`refs/heads/claim/${issue}$`, 'm'),
      '마지막 step이 병합됐는데 선점이 풀리지 않았다',
    );
  },
} satisfies Scenario;
