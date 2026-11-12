// 테스트용 가짜 에이전트. runner가 stdin으로 프롬프트를 넘긴다.
// FAKE_BEHAVIOR(JSON 파일): { "<slug>": { "plan": ["ok"], "0": ["fail", "ok"], "steps": 2 } }
//   ok      : 계획 작성이면 계획·step 파일을, step이면 AC가 확인하는 파일을 만들고 커밋한다
//   fail    : 아무것도 하지 않고 "완료했다"고만 말한다(세션 주장은 판정 근거가 아님을 확인)
//   timeout : 오래 멈춘다(세션 시간 제한 확인)
//   limit   : 사용량 한도 메시지로 실패한다(환경 장애, 실패로 세지 않음)
//   question: 계획 작성이면 ok처럼 계획을 채우고 "열린 질문"에 `### 질문: 데모 질문` 블록을 남긴다.
//             step이면 계획의 "열린 질문"에 `### 질문: 스텝 질문` 블록만 남기고 멈춘다(커밋하지 않는다)
// 충돌 해결 프롬프트("# 이번 작업: 충돌 해결")는 behavior의 "conflict" 순서를 쓴다.
//   ok   : "## 충돌 파일"에 나열된 파일에서 충돌 표시 줄(<<<<<<<, =======, >>>>>>>)을 지운다(양쪽 내용 유지). git은 쓰지 않는다
//   fail : 아무것도 하지 않는다
// FAKE_LOG: 받은 프롬프트를 JSON 줄로 남긴다.
// FAKE_RESULT_JSON=1: 끝에 Claude `-p --output-format json` 형식의 결과 객체(권한 거부 포함)를 출력한다.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const prompt = readFileSync(0, 'utf8');
const planning = prompt.includes('# 이번 작업: 계획 작성');
const resolving = prompt.includes('# 이번 작업: 충돌 해결');
const planFile = /계획 파일: `([^`]+)`/.exec(prompt)?.[1] ?? '';
const id = /(\d{8}-[a-z0-9-]+?)(?:\/plan\.md|\.md)$/.exec(planFile)?.[1] ?? '';
const step = planning
  ? 'plan'
  : resolving
    ? 'conflict'
    : (/step 지시서 \([^)]*step(\d+)\.md/.exec(prompt)?.[1] ?? '0');
const slug = id.replace(/^\d{8}-/, '');

if (process.env.FAKE_LOG)
  appendFileSync(process.env.FAKE_LOG, JSON.stringify({ slug, step, prompt }) + '\n');

const bfile = process.env.FAKE_BEHAVIOR ?? '';
const behavior = bfile && existsSync(bfile) ? JSON.parse(readFileSync(bfile, 'utf8')) : {};
const seq: string[] = behavior[slug]?.[step] ?? [];
const action = seq.shift() ?? 'ok';
if (bfile) writeFileSync(bfile, JSON.stringify(behavior));

const git = (...args: string[]) => execFileSync('git', args, { stdio: 'ignore' });

if (action === 'limit') {
  process.stderr.write('Claude AI usage limit reached|1700000000\n');
  process.exit(1);
}
if (action === 'timeout') {
  setTimeout(() => process.exit(0), 600_000);
} else if (action === 'fail') {
  process.stdout.write('완료했습니다! 모든 작업을 마쳤습니다.\n');
} else if (resolving) {
  const list = prompt.split('## 충돌 파일')[1]?.split('\n## ')[0] ?? '';
  for (const m of list.matchAll(/^- `([^`]+)`/gm)) {
    const f = m[1];
    if (!existsSync(f)) continue;
    const kept = readFileSync(f, 'utf8')
      .split('\n')
      .filter((l) => !/^(<{7}|={7}|>{7})( |$)/.test(l));
    writeFileSync(f, kept.join('\n'));
  }
} else if (planning) {
  const steps = Number(behavior[slug]?.steps ?? 2);
  let text = readFileSync(planFile, 'utf8').replace(/^status: draft/m, 'status: active');
  const fill: Record<string, string> = {
    '## 목표와 수용 기준': `- ${slug} 기능을 만든다. 각 step의 파일이 생기면 완료`,
    '## 범위 / 비범위': '- out/ 아래 파일만',
    '## 관련 파일·문서': '- out/',
    '## 검증 방법과 결과': '- AC 명령(test -f)',
  };
  for (const [h, line] of Object.entries(fill)) text = text.replace(h, `${h}\n${line}`);
  if (action === 'question')
    text = text.replace(
      '## 열린 질문',
      '## 열린 질문\n\n### 질문: 데모 질문\n\n- A) 하나 — 영향: 작다\n- B) 둘 — 영향: 크다\n- 추천: A. 이유: 단순하다\n',
    );
  writeFileSync(planFile, text);
  const dir = path.dirname(planFile);
  const list = Array.from({ length: steps }, (_, i) => ({
    step: i,
    name: `part-${i}`,
    status: 'pending',
  }));
  writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ plan: id, steps: list }, null, 2));
  for (let i = 0; i < steps; i++) {
    writeFileSync(
      path.join(dir, `step${i}.md`),
      `# Step ${i}: part-${i}\n\n## 읽어야 할 파일\n- AGENTS.md\n\n## 작업\n- out/${slug}-s${i}.txt를 만든다\n\n## Acceptance Criteria\n\`\`\`bash\ntest -f out/${slug}-s${i}.txt\n\`\`\`\n\n## 금지사항\n- 다른 파일을 고치지 마라. 이유: 범위\n`,
    );
  }
} else if (action === 'question') {
  const text = readFileSync(planFile, 'utf8').replace(
    '## 열린 질문',
    '## 열린 질문\n\n### 질문: 스텝 질문\n\n- A) 이쪽 — 영향: 작다\n- B) 저쪽 — 영향: 크다\n- 추천: A. 이유: 단순하다\n',
  );
  writeFileSync(planFile, text);
  process.stdout.write('판단이 필요해 열린 질문에 적고 멈춘다.\n');
} else {
  mkdirSync('out', { recursive: true });
  writeFileSync(`out/${slug}-s${step}.txt`, `step ${step}\n`);
  const idxFile = path.join(path.dirname(planFile), 'index.json');
  if (existsSync(idxFile)) {
    const idx = JSON.parse(readFileSync(idxFile, 'utf8'));
    const entry = idx.steps.find((s: { step: number }) => s.step === Number(step));
    if (entry) entry.summary = `out/${slug}-s${step}.txt 생성`;
    writeFileSync(idxFile, JSON.stringify(idx, null, 2));
  }
  git('add', '-A');
  git('commit', '-q', '-m', `feat: ${slug} step ${step}`);
}

if (process.env.FAKE_RESULT_JSON && action !== 'timeout') {
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 7,
      terminal_reason: 'completed',
      session_id: `fake-${slug}-${step}`,
      result: '끝났습니다',
      permission_denials: [
        { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'sed -n 1,20p a.ts' } },
        { tool_name: 'Bash', tool_use_id: 't2', tool_input: { command: 'find . -name x' } },
        { tool_name: 'WebFetch', tool_use_id: 't3', tool_input: { url: 'https://example.com' } },
      ],
    }) + '\n',
  );
}
