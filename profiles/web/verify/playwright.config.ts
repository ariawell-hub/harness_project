// verify의 Playwright 설정(설계서 11.1절). `node scripts/harness.ts verify`가 실행기를 띄울 때만 쓴다:
// 앱 주소, 거부 프록시 주소, 출력 폴더는 verify가 그 실행에서 정해 환경 변수로 넘긴다.
// 이 파일은 보호 경로다. 주소 제한을 풀거나 다른 브라우저에 붙이려면 계획에 적고 제작자 승인을 받는다.
//
// @playwright/test에서는 형식만 가져온다. 하네스 리포의 테스트가 이 파일을 패키지 없이 불러 값을 확인한다.
import path from 'node:path';
import type { PlaywrightTestConfig } from '@playwright/test';

const HOW =
  '`node scripts/harness.ts verify`로 실행하라(verify가 앱과 거부 프록시를 띄우고 이 값을 넘긴다)';

function need(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`verify 설정: 환경 변수 ${name}이 없다. ${HOW}`);
  return value;
}

/** verify가 띄운 로컬 주소. 포트를 돌려준다. 다른 호스트·스킴·경로가 붙은 값은 받지 않는다 */
function localPort(name: string): string {
  const m = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(need(name));
  if (!m || Number(m[1]) > 65535)
    throw new Error(`verify 설정: ${name}이 http://127.0.0.1:<포트> 꼴이 아니다. ${HOW}`);
  return m[1];
}

const appPort = localPort('HARNESS_VERIFY_BASE_URL');
const proxyPort = localPort('HARNESS_VERIFY_PROXY');
const baseURL = `http://127.0.0.1:${appPort}`;
const out = need('HARNESS_VERIFY_OUT');
if (!path.isAbsolute(out))
  throw new Error(`verify 설정: HARNESS_VERIFY_OUT이 절대 경로가 아니다. ${HOW}`);

// 리포 루트는 실행 폴더다(verify가 실행기를 루트에서 띄운다). 이 파일의 위치에서 계산하지 않는다:
// 대상 리포의 모듈 방식(CommonJS, ES 모듈)에 따라 쓸 수 있는 수단이 다르다
const root = process.cwd();

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
/** scripts/verify/judge.ts의 isScenarioPath와 같은 규칙(하네스 리포의 테스트가 둘을 대 본다) */
const isScenarioPath = (p: unknown): p is string =>
  typeof p === 'string' &&
  p.startsWith('e2e/') &&
  p.endsWith('.spec.ts') &&
  p.split('/').every((segment) => SEGMENT.test(segment));

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 시나리오 지정(HARNESS_VERIFY_SCENARIOS, JSON 배열). 있으면 그 파일들의 절대 경로에 처음부터 끝까지 일치하는 것만 고른다.
 * 명령행의 파일 인자를 쓰지 않는 이유: Playwright가 정규식으로 읽어 경로가 겹치는 다른 파일까지 고른다.
 * 값이 틀리면 전체 실행으로 넘어가지 않고 오류로 끝난다
 */
function selected(): RegExp[] | null {
  const raw = process.env.HARNESS_VERIFY_SCENARIOS;
  if (raw === undefined) return null;
  let list: unknown = null;
  try {
    list = JSON.parse(raw);
  } catch {
    // 아래에서 오류로 끝난다
  }
  if (!Array.isArray(list) || list.length === 0 || !list.every(isScenarioPath))
    throw new Error(
      `verify 설정: HARNESS_VERIFY_SCENARIOS가 시나리오 경로(e2e/….spec.ts)의 JSON 배열이 아니다. ${HOW}`,
    );
  return list.map((p) => new RegExp(`^${literal(path.join(root, p))}$`));
}

const config: PlaywrightTestConfig = {
  testDir: path.join(root, 'e2e'),
  testMatch: selected() ?? '**/*.spec.ts',
  forbidOnly: true,
  retries: 0,
  reporter: [['line'], ['json', { outputFile: path.join(out, 'report.json') }]],
  // 스크린샷, trace, 영상은 모두 local/ 아래에 둔다. 화면의 글자와 요청 헤더·쿠키가 담기므로 올리지 않는다
  outputDir: path.join(out, 'local', 'artifacts'),
  use: {
    // Playwright가 받은 Chromium을 새로 띄운다. 시나리오마다 새 컨텍스트와 임시 프로필이다.
    // 이미 떠 있는 브라우저나 사용자 프로필에 붙는 설정을 여기에 더하지 않는다(E5)
    browserName: 'chromium',
    baseURL,
    // 서비스 워커는 등록·실행되지 않는다. 허용하는 스위치를 두지 않는다
    serviceWorkers: 'block',
    screenshot: 'on',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    launchOptions: {
      // 주소 제한: 브라우저의 요청을 모두 거부 프록시로 보내고, 이 실행의 앱 주소 둘만 프록시를 지나지 않게 한다.
      // 우회 항목은 스킴까지 적는다. 호스트:포트만 적으면 같은 포트로 가는 https·wss 요청이 프록시를 지나지 않는다.
      // 다른 항목(루프백 전체, 와일드카드, 다른 포트)을 더하지 않는다
      proxy: {
        server: `http://127.0.0.1:${proxyPort}`,
        bypass: `<-loopback>,http://127.0.0.1:${appPort},ws://127.0.0.1:${appPort}`,
      },
    },
  },
};

export default config;
