// metrics 명령이 띄워도 되는 자식 프로세스의 허용 목록(계획 20261119-metrics step0 1절 "읽기 요청 꼴", 5절).
// 명령과 인자 배열 전체(길이와 자리마다의 값)가 맞을 때만 허용한다. 금지할 옵션은 나열하지 않는다:
// 금지할 표기(-X POST, --method=POST, -XPOST …)는 끝없이 늘고, 실제로 쓰는 조회는 몇 개뿐이며 꼴이 고정돼 있다.
// 뒤 step이 조회나 읽기 명령을 더하면 여기에 꼴을 더하고, 고정 응답과 호출 단언도 함께 넓힌다.

/** 인자 한 자리. 문자열은 그대로 같아야 하고 정규식은 그 자리 전체와 맞아야 한다 */
export type Slot = string | RegExp;

export interface Shape {
  name: string;
  args: Slot[];
  /** 있으면 `args` 뒤에 한 자리 이상이 더 오고, 그 자리마다 이 식과 맞아야 한다 */
  rest?: RegExp;
}

const DAY = String.raw`\d{4}-\d{2}-\d{2}`;
const REPO = String.raw`repos/\{owner\}/\{repo\}`;
/** `--jq` 바로 뒤 한 자리의 식 */
const JQ = /^[\s\S]+$/;

/**
 * `gh`의 읽기 요청 꼴. step0의 넷(PR 조회, Issue 조회, 실행 조회, 원장 댓글 조회)과
 * step1의 다섯(PR 커밋 조회, 커밋 상태 조회, 라벨 이벤트 조회, 리포 댓글 조회, head별 PR 조회)
 */
export function ghReadShapes(defaultBranch: string): Shape[] {
  return [
    {
      name: 'prs',
      args: [
        'pr',
        'list',
        '--state',
        'merged',
        '--base',
        defaultBranch,
        '--search',
        new RegExp(`^merged:${DAY}\\.\\.${DAY}$`),
        '--limit',
        '1000',
        '--json',
        /^[A-Za-z]+(,[A-Za-z]+)*$/,
      ],
    },
    {
      name: 'issues',
      args: [
        'issue',
        'list',
        '--state',
        'all',
        '--label',
        'bug',
        '--search',
        new RegExp(`^created:${DAY}\\.\\.${DAY}$`),
        '--limit',
        '1000',
        '--json',
        'number,createdAt',
      ],
    },
    {
      name: 'runs',
      args: [
        'api',
        '--paginate',
        new RegExp(`^${REPO}/actions/runs\\?created=${DAY}&per_page=100$`),
        '--jq',
        JQ,
      ],
    },
    {
      name: 'comments',
      args: [
        'api',
        '--paginate',
        new RegExp(`^${REPO}/issues/\\d+/comments\\?per_page=100$`),
        '--jq',
        JQ,
      ],
    },
    {
      name: 'prCommits',
      args: [
        'api',
        '--paginate',
        new RegExp(`^${REPO}/pulls/\\d+/commits\\?per_page=100$`),
        '--jq',
        JQ,
      ],
    },
    {
      name: 'statuses',
      args: [
        'api',
        '--paginate',
        new RegExp(`^${REPO}/commits/[0-9a-f]{40}/statuses\\?per_page=100$`),
        '--jq',
        JQ,
      ],
    },
    {
      name: 'events',
      args: ['api', '--paginate', 'repos/{owner}/{repo}/issues/events?per_page=100', '--jq', JQ],
    },
    {
      name: 'repoComments',
      args: [
        'api',
        '--paginate',
        new RegExp(`^${REPO}/issues/comments\\?since=${DAY}T00:00:00Z&per_page=100$`),
        '--jq',
        JQ,
      ],
    },
    {
      name: 'headPrs',
      // `<브랜치>`는 한 자리의 문자열이다. 옵션으로 읽힐 값(-로 시작)은 자료원이 넘기지 않는다
      args: [
        'pr',
        'list',
        '--state',
        'all',
        '--head',
        /^[^-][\s\S]*$/,
        '--limit',
        '100',
        '--json',
        'number',
      ],
    },
  ];
}

/** `--` 뒤 한 자리의 리포 상대 경로. 옵션(-), 절대 경로(/), pathspec 표식(:)으로 시작하지 않는다 */
const REPO_PATH = /^(?![-/:])[^\0]+$/;

/**
 * `repoInfo`(scripts/lib/git.ts)가 실행하는 둘과 `docLint`(scripts/gates/doc-lint.ts)가 실행하는 셋
 * (문서 목록과 커밋 시각은 step2, 변경 조각 목록은 계획 20261123-change-fragments step0).
 * 다섯 다 읽기만 한다. `log`는 `--` 앞 네 자리가 맞고 그 뒤가 경로뿐일 때만 맞는다
 */
export const GIT_READ_SHAPES: Shape[] = [
  {
    name: 'rev-parse',
    args: ['rev-parse', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
  },
  { name: 'symbolic-ref', args: ['symbolic-ref', '--short', '-q', 'HEAD'] },
  {
    name: 'ls-files',
    args: ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '*.md'],
  },
  { name: 'log', args: ['log', '-1', '--format=%ct', '--'], rest: REPO_PATH },
  {
    name: 'ls-files-changes',
    args: [
      'ls-files',
      '-z',
      '--cached',
      '--others',
      '--exclude-standard',
      '--',
      'docs/harness/changes',
    ],
  },
];

export function fits(shape: Shape, args: readonly string[]): boolean {
  const fixed = shape.args.length;
  if (shape.rest ? args.length <= fixed : args.length !== fixed) return false;
  const { rest } = shape;
  return (
    shape.args.every((slot, i) =>
      typeof slot === 'string' ? slot === args[i] : slot.test(args[i]),
    ) &&
    (!rest || args.slice(fixed).every((a) => rest.test(a)))
  );
}

/** 인자 배열과 맞는 꼴. 없으면 null */
export function matchShape(shapes: readonly Shape[], args: readonly string[]): Shape | null {
  return shapes.find((s) => fits(s, args)) ?? null;
}
