// 브랜치 규칙(규칙 세트) 읽기와 판정(Issue #250). `GET repos/{repo}/rules/branches/{branch}`는 규칙 세트의 규칙을
// 읽기 권한으로 돌려준다(기존 보호 규칙의 리뷰 설정은 관리자가 아닌 토큰으로 읽을 수 없다). 판정 job(`readDismissRule`)과
// GitHub 포트(`branchRules`, ops-check)가 같은 경로·쪽 모으기·판정을 쓴다.

/** 한 쪽의 크기(GitHub의 최대) */
export const RULES_PER_PAGE = 100;
/** 쪽 나눔이 끝나지 않을 때 멈추는 쪽 수 */
export const RULES_MAX_PAGES = 20;

/** 규칙 목록 한 쪽의 API 경로. 브랜치 이름은 경로 한 구간이다(`release/1.x` → `release%2F1.x`) */
export function rulesPath(repo: string, branch: string, page: number): string {
  return `repos/${repo}/rules/branches/${encodeURIComponent(branch)}?per_page=${RULES_PER_PAGE}&page=${page}`;
}

/** 받은 쪽을 쌓고, 끝났으면 true(쪽이 덜 찼다). 쪽이 배열이 아니면 던진다 */
function addPage(pages: unknown[], got: unknown, page: number): boolean {
  if (!Array.isArray(got)) throw new Error(`규칙 목록 ${page}쪽이 배열이 아니다`);
  pages.push(got);
  return got.length < RULES_PER_PAGE;
}
const tooMany = () => new Error(`규칙 목록이 ${RULES_MAX_PAGES}쪽을 넘는다`);

/** 1쪽부터 쪽이 덜 찰 때까지 읽어 쪽들(배열의 배열)을 돌려준다. 끝까지 읽지 못하면 던진다 */
export function readRulePagesSync(
  get: (path: string) => unknown,
  repo: string,
  branch: string,
): unknown[] {
  const pages: unknown[] = [];
  for (let page = 1; page <= RULES_MAX_PAGES; page++)
    if (addPage(pages, get(rulesPath(repo, branch, page)), page)) return pages;
  throw tooMany();
}

/** readRulePagesSync의 비동기 판(판정 job의 HTTP 조회) */
export async function readRulePages(
  get: (path: string) => Promise<unknown>,
  repo: string,
  branch: string,
): Promise<unknown[]> {
  const pages: unknown[] = [];
  for (let page = 1; page <= RULES_MAX_PAGES; page++)
    if (addPage(pages, await get(rulesPath(repo, branch, page)), page)) return pages;
  throw tooMany();
}

/**
 * 쪽들(배열의 배열, `gh api --paginate --slurp`의 꼴)에 "새 커밋 push 때 오래된 승인 철회"가 켜진 `pull_request` 규칙이
 * 있는가. 꼴이 틀리면(배열이 아님, 항목에 `type` 없음) null
 */
export function dismissRuleOf(pages: unknown): boolean | null {
  if (!Array.isArray(pages)) return null;
  let found = false;
  for (const page of pages) {
    if (!Array.isArray(page)) return null;
    for (const rule of page as unknown[]) {
      const r = rule as {
        type?: unknown;
        parameters?: { dismiss_stale_reviews_on_push?: unknown };
      };
      if (!r || typeof r !== 'object' || typeof r.type !== 'string') return null;
      if (r.type === 'pull_request' && r.parameters?.dismiss_stale_reviews_on_push === true)
        found = true;
    }
  }
  return found;
}
