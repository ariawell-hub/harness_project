// MCP 도구 규칙(설계서 13.1절, TD-13): 대화 세션의 MCP 도구 호출이 L1 훅을 거치고,
// 삭제 계열·메일 발송(R14)과 브라우저 도구의 GitHub 접근(R20)이 종료 코드 2로 막히는가.
// 그 밖의 MCP 도구(검색·읽기·초안·GitHub이 아닌 주소)는 막히지 않아야 한다(제작자 결정: 삭제를 뺀 적극 활용).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertAllowed, assertBlocked, type Scenario } from '../run.ts';

export default {
  id: 'mcp-guard',
  covers: 'R14',
  title:
    'MCP 도구의 삭제·메일 발송·브라우저의 GitHub 접근을 훅이 종료 코드 2로 막고, 그 밖은 통과시킨다',
  run(ctx) {
    const s = ctx.sample();
    const mcp = (tool_name: string, tool_input: Record<string, unknown>) =>
      ctx.hook(s, { tool_name, tool_input });

    // 훅 등록: 세션 설정의 PreToolUse matcher가 MCP 도구 이름에 맞아야 훅이 불린다
    const settings = JSON.parse(
      readFileSync(path.join(s.root, '.claude/settings.json'), 'utf8'),
    ) as {
      hooks?: { PreToolUse?: { matcher?: string; hooks?: { command?: string }[] }[] };
    };
    const hooked = (settings.hooks?.PreToolUse ?? []).some(
      (h) =>
        new RegExp(`^(?:${h.matcher ?? ''})$`).test('mcp__claude_ai_Gmail__trash_message') &&
        (h.hooks ?? []).some((x) => (x.command ?? '').includes('scripts/hooks/guard.ts')),
    );
    assert.ok(hooked, '.claude/settings.json의 PreToolUse matcher가 mcp__ 도구를 훅에 걸지 않는다');

    const github = 'https://github.com/o/r/settings/branches';
    assertBlocked(
      mcp('mcp__claude_ai_Gmail__trash_message', { messageId: 'm1' }),
      /R14/,
      'Gmail trash_message',
    );
    assertBlocked(
      mcp('mcp__claude_ai_Notion__notion-delete-pages', { page_ids: ['p1'] }),
      /R14/,
      'Notion delete-pages',
    );
    assertBlocked(
      mcp('mcp__claude_ai_Gmail__send_message', { to: 'a@example.com', body: 'x' }),
      /R14/,
      'Gmail send_message',
    );
    assertBlocked(
      mcp('mcp__claude-in-chrome__navigate', { url: github, tabId: 1 }),
      /R20/,
      'Chrome navigate(GitHub)',
    );
    assertBlocked(
      mcp('mcp__playwright__browser_navigate', { url: github }),
      /R20/,
      'Playwright navigate(GitHub)',
    );
    // 대조군
    assertAllowed(mcp('mcp__claude_ai_Gmail__search_threads', { query: 'x' }), 'Gmail 검색');
    assertAllowed(
      mcp('mcp__claude_ai_Google_Drive__read_file_content', { fileId: 'f1' }),
      'Drive 읽기',
    );
    assertAllowed(
      mcp('mcp__claude_ai_Gmail__create_draft', { to: 'a@example.com', body: github }),
      'Gmail 초안',
    );
    assertAllowed(mcp('mcp__claude_ai_Gmail__untrash_message', { messageId: 'm1' }), 'Gmail 복구');
    assertAllowed(
      mcp('mcp__claude-in-chrome__navigate', { url: 'https://example.com/docs', tabId: 1 }),
      'Chrome navigate(다른 사이트)',
    );
  },
} satisfies Scenario;
