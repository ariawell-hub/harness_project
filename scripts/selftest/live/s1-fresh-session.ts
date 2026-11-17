// S1(실제 세션): 새 세션이 안내 문서에서 출발해 선점되지 않은 다음 작업을 찾는가(설계서 12.4절).
// 프롬프트는 AGENTS.md나 명령을 가리키지 않는다. 세션이 스스로 찾아야 한다.
import type { LiveScenario } from '../live.ts';
import type { Sample } from '../run.ts';

const expected = new WeakMap<Sample, { free: number; taken: number[] }>();

export default {
  id: 's1-fresh-session',
  covers: 'S1',
  setup(ctx) {
    const s = ctx.sample();
    // 답에 섞인 다른 숫자("1단계" 등)와 겹치지 않게 Issue 번호를 41부터 준다
    ctx.github(s).update((state) => {
      state.next = 41;
    });
    const claimed = s.issue('남이 선점한 작업');
    const free = s.issue('선점되지 않은 작업');
    const fromBot = s.issue('봇이 제안한 작업', { author: s.bot });
    // 다른 작업자의 선점: 원격의 claim/<N> 브랜치
    const claim = s.git([
      'commit-tree',
      'HEAD^{tree}',
      '-p',
      'HEAD',
      '-m',
      `claim #${claimed} by other-worker at ${new Date().toISOString()}`,
    ]);
    s.git(['push', '-q', 'origin', `${claim}:refs/heads/claim/${claimed}`]);
    expected.set(s, { free, taken: [claimed, fromBot] });
    return {
      sample: s,
      prompt:
        '이 리포의 안내 문서를 읽고 다음에 할 작업의 Issue 번호만 답하라. 설명 없이 번호만 적는다.',
    };
  },
  judge({ sample, text }) {
    const e = expected.get(sample);
    if (!e) return { pass: false, detail: '이 시나리오가 준비한 샘플이 아니다' };
    const answered = [...new Set((text.match(/\d+/g) ?? []).map(Number))];
    const wrong = answered.filter((n) => e.taken.includes(n));
    const pass = answered.includes(e.free) && !wrong.length;
    return {
      pass,
      detail: pass
        ? `선점되지 않은 제작자 Issue #${e.free}를 답했다`
        : `기대 #${e.free}(선점·봇 Issue ${e.taken.map((n) => `#${n}`).join(', ')} 제외), 답: ${text.trim().slice(0, 120) || '(없음)'}`,
    };
  },
} satisfies LiveScenario;
