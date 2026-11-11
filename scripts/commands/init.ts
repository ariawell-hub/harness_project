// init (16절 새 프로젝트 3): 프로파일 선택, 표준 명령 연결, 템플릿 복사, 남은 수동 작업 안내.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE } from '../lib/config.ts';
import { log } from '../lib/util.ts';

interface ProfileFile {
  name: string;
  version: string;
  description?: string;
  /** harness.config.json에 그대로 덮어쓸 항목 */
  config: Record<string, unknown>;
  templates?: { from: string; to: string; replacePlaceholder?: boolean }[];
}

export function init(
  root: string,
  profile: string,
  opts: { owner?: string; bot?: string },
): number {
  const pf = path.join(root, 'profiles', profile, 'profile.json');
  if (!existsSync(pf)) {
    process.stderr.write(
      `프로파일이 없다: ${pf}\n사용 가능: profiles/ 아래 폴더 이름(core, web)\n`,
    );
    return 1;
  }
  const p = JSON.parse(readFileSync(pf, 'utf8')) as ProfileFile;
  const cfgPath = path.join(root, CONFIG_FILE);
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
  Object.assign(cfg, p.config);
  cfg.profile = p.name;
  cfg.profileVersion = `${p.name}@${p.version}`;
  const gh = (cfg.github ?? {}) as Record<string, unknown>;
  if (opts.owner) gh.owner = opts.owner;
  if (opts.bot) gh.bot = opts.bot;
  cfg.github = gh;
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  log(`프로파일 ${p.name}@${p.version}을 ${CONFIG_FILE}에 적용했다.`);

  for (const t of p.templates ?? []) {
    const src = path.join(root, 'profiles', profile, t.from);
    const dst = path.join(root, t.to);
    if (existsSync(dst)) {
      const placeholder =
        t.replacePlaceholder && readFileSync(dst, 'utf8').includes('harness:placeholder');
      if (!placeholder) {
        log(`- 건너뜀(이미 있음): ${t.to}`);
        continue;
      }
    }
    mkdirSync(path.dirname(dst), { recursive: true });
    copyFileSync(src, dst);
    log(`- 템플릿 복사: ${t.to}`);
  }

  log(`
남은 수동 작업 (제작자가 직접, docs/harness/design.md 0절·16절):
  1. 전제 조건 E1~E5: 봇 계정 + 리포 한정 토큰(90일 이하), GitHub Pro, 이 Mac에서 제작자 gh 로그아웃(E5)
  2. 원격 리포 생성 후 main push, 0.2절 브랜치 보호(PR 필수, force push 금지, 최신 브랜치 필수, stale 승인 무효화)
  3. Actions: 기본 권한 읽기 전용, "Actions가 PR 승인" 끔, 리포 수준 시크릿 없음
  4. 필수 상태 체크 등록: check, plan-gate (체크가 생길 때마다 추가)
  5. ${CONFIG_FILE}의 github.owner(제작자 계정)와 github.bot(봇 계정) 확인
  6. 라벨 만들기: needs-human, priority:high|medium|low, size:small|medium|large, risk:low|high, bug
  7. runner 실행 환경: GH_TOKEN=<봇 토큰> node scripts/harness.ts run --worker runner-1`);
  return 0;
}
