// verify 시나리오 예시. `node scripts/harness.ts verify`가 앱을 띄우고 e2e/ 아래의 *.spec.ts를 돌린다.
// test와 expect는 하네스 fixture에서 가져온다. @playwright/test의 test를 직접 쓰면 관찰 기록이 없어 verify가 실패한다.
// 쓰는 법과 통과 기준: profiles/web/README.md의 verify 항목.
import { expect, test } from '../profiles/web/verify/fixture';

test('첫 화면이 열리고 제목이 있다', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/.+/);
});
