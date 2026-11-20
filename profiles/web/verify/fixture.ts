// verify의 관찰 fixture(설계서 11.1절). 시나리오는 @playwright/test가 아니라 이 파일의 test를 쓴다:
//
//   import { expect, test } from '../profiles/web/verify/fixture';
//
// 시나리오마다 콘솔 에러, 실패한 요청, 앱 주소 밖으로 가려던 요청을 적어 'harness-verify' 첨부로 붙인다.
// verify는 이 첨부가 없는 시나리오를 실패로 본다.
// 이 fixture는 요청을 막지 않는다. 막는 것은 verify가 띄운 거부 프록시이고, 여기서는 무엇이 있었는지만 적는다.
// 요청·응답의 헤더, 쿠키, 본문은 적지 않는다.
// 무엇이 앱 주소 밖인지, 선언이 어떤 항목에 맞는지 같은 판단은 observe.ts에 있다(하네스 리포의 테스트가 직접 본다).
import { expect, test as base, type Page } from '@playwright/test';
import {
  checked,
  clip,
  ITEMS_MAX,
  requestOutside,
  settle,
  socketOutside,
  type ConsoleError,
  type FailedRequest,
  type Pattern,
} from './observe';

/** 관찰 기록 첨부의 이름. 형식은 scripts/verify/judge.ts의 Observation(version 1)이다 */
const OBSERVATION_NAME = 'harness-verify';

export interface Verify {
  /**
   * 이 시나리오가 일부러 내는 콘솔 에러를 선언한다. 문구에 `pattern`이 들어 있으면(정규식이면 맞으면) 건수에서 뺀다.
   * 실패한 요청은 빼지 않는다
   */
  allowConsoleError(pattern: Pattern): void;
  /**
   * 이 시나리오가 일부러 내는 실패한 요청(앱 주소로 간 것)을 선언한다. URL에 `pattern`이 들어 있으면(정규식이면 맞으면)
   * 건수에서 뺀다. 콘솔 에러는 빼지 않는다(브라우저는 404 응답에 콘솔 에러도 낸다. 그것은 allowConsoleError로 따로 선언한다).
   * 앱 주소 밖으로 가려던 요청은 뺄 수 없다
   */
  allowFailedRequest(pattern: Pattern): void;
}

function appUrl(): URL {
  const raw = process.env.HARNESS_VERIFY_BASE_URL;
  if (!raw)
    throw new Error(
      '환경 변수 HARNESS_VERIFY_BASE_URL이 없다. `node scripts/harness.ts verify`로 실행하라',
    );
  return new URL(raw);
}

export const test = base.extend<{ verify: Verify }>({
  verify: [
    async ({ context }, use, testInfo) => {
      const app = appUrl();
      const consoleErrors: ConsoleError[] = [];
      const failedRequests: FailedRequest[] = [];
      let dropped = 0;
      const add = <T>(list: T[], item: T) => {
        if (list.length < ITEMS_MAX) list.push(item);
        else dropped++;
      };

      // 컨텍스트의 모든 요청을 본다(리다이렉트의 뒤 목적지도 요청으로 온다). 앱 주소 밖이면 한 번 적는다
      context.on('request', (request) => {
        if (requestOutside(request.url(), app))
          add(failedRequests, {
            url: clip(request.url()),
            reason: '앱 주소 밖으로 가려는 요청',
            blocked: true,
          });
      });
      context.on('requestfailed', (request) => {
        if (requestOutside(request.url(), app)) return;
        add(failedRequests, {
          url: clip(request.url()),
          reason: clip(request.failure()?.errorText ?? '요청 실패'),
          blocked: false,
        });
      });
      context.on('response', (response) => {
        if (response.status() < 400 || requestOutside(response.url(), app)) return;
        add(failedRequests, {
          url: clip(response.url()),
          reason: `HTTP ${response.status()}`,
          blocked: false,
        });
      });
      context.on('console', (message) => {
        if (message.type() === 'error') add(consoleErrors, { text: clip(message.text()) });
      });
      // 잡히지 않은 예외(페이지의 pageerror를 컨텍스트에서 한 번에 받는다)
      context.on('weberror', (webError) => {
        add(consoleErrors, { text: clip(`잡히지 않은 예외: ${webError.error().message}`) });
      });
      const watch = (page: Page) => {
        page.on('websocket', (socket) => {
          if (socketOutside(socket.url(), app))
            add(failedRequests, {
              url: clip(socket.url()),
              reason: '앱 주소 밖으로 가려는 웹소켓',
              blocked: true,
            });
        });
      };
      for (const page of context.pages()) watch(page);
      context.on('page', watch);

      const allowConsole: Pattern[] = [];
      const allowRequests: Pattern[] = [];
      try {
        await use({
          allowConsoleError: (pattern) => {
            allowConsole.push(checked(pattern));
          },
          allowFailedRequest: (pattern) => {
            allowRequests.push(checked(pattern));
          },
        });
      } finally {
        // 무엇을 빼고 무엇을 남기는지는 observe.ts의 settle이 정한다(blocked는 어느 선언으로도 빠지지 않는다)
        await testInfo.attach(OBSERVATION_NAME, {
          body: JSON.stringify(
            settle({ consoleErrors, failedRequests, allowConsole, allowRequests, dropped }),
          ),
          contentType: 'application/json',
        });
      }
    },
    { auto: true },
  ],
});

export { expect };
