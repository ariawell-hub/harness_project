// secret-scan (R10, 14.2절). 로컬은 커밋 범위 + 작업 트리 변경을, CI는 PR의 모든 커밋을 검사한다.
// 중간 커밋에 들어갔다 지워진 시크릿도 원격에는 남으므로 최종 diff가 아니라 커밋마다 본다.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { runSync } from '../lib/exec.ts';
import { git, gitTry, hasCommits } from '../lib/git.ts';
import type { Problem } from '../lib/util.ts';
import { parseAddedLines } from './bypass-scan.ts';

const DOC = 'docs/harness/design.md R10, 14.2절 / docs/SECURITY.md';
export const REQUIRED_IGNORES = ['.env', '.env.*', '!.env.example'];

export function gitignoreProblems(root: string): Problem[] {
  const f = path.join(root, '.gitignore');
  const lines = existsSync(f)
    ? readFileSync(f, 'utf8')
        .split('\n')
        .map((l) => l.trim())
    : [];
  const missing = REQUIRED_IGNORES.filter((x) => !lines.includes(x));
  if (!missing.length) return [];
  return [
    {
      rule: 'R10 .gitignore',
      what: `.gitignore에 시크릿 항목이 없다: ${missing.join(', ')}`,
      how: '.gitignore에 `.env`, `.env.*`, `!.env.example` 세 줄을 되돌려라',
      doc: DOC,
    },
  ];
}

function gitleaksAvailable(): boolean {
  return runSync('gitleaks', ['version']).code === 0;
}

export interface SecretScanOptions {
  base: string | null;
  committedOnly: boolean;
}

export function secretScan(root: string, opts: SecretScanOptions): Problem[] {
  const problems = gitignoreProblems(root);
  if (!gitleaksAvailable()) {
    problems.push({
      rule: 'R10 시크릿 스캔',
      what: 'gitleaks가 설치되어 있지 않아 시크릿 스캔을 할 수 없다',
      how: 'macOS: `brew install gitleaks`, Windows: `winget install gitleaks`, 그 밖: https://github.com/gitleaks/gitleaks/releases',
      doc: DOC,
    });
    return problems;
  }
  const findings: string[] = [];
  // 1) 커밋 범위
  if (opts.base && hasCommits(root)) {
    const range = `${opts.base}..HEAD`;
    const count = gitTry(['rev-list', '--count', range], root);
    if (count.ok && Number(count.stdout.trim()) > 0) {
      const r = runSync(
        'gitleaks',
        ['git', '--no-banner', '--redact', '--exit-code', '1', `--log-opts=${range}`, root],
        { cwd: root, timeoutMs: 300_000 },
      );
      if (r.code === 1) findings.push(`커밋 ${range}:\n${(r.stdout + r.stderr).trim()}`);
      else if (r.code !== 0) findings.push(`gitleaks 실행 오류(${r.code}): ${r.stderr.trim()}`);
    }
  }
  // 2) 작업 트리 변경 (로컬만)
  if (!opts.committedOnly) {
    let chunks = '';
    if (hasCommits(root)) {
      const added = parseAddedLines(
        git(['diff', '-U0', '--no-color', '--no-ext-diff', 'HEAD'], root),
      );
      chunks += added.map((a) => a.text).join('\n') + '\n';
    }
    const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'], root)
      .split('\0')
      .filter(Boolean);
    for (const f of untracked) {
      try {
        const t = readFileSync(path.join(root, f), 'utf8');
        if (!t.includes('\0')) chunks += `\n# file: ${f}\n${t}`;
      } catch {
        // 읽을 수 없는 파일은 건너뛴다
      }
    }
    if (chunks.trim()) {
      const r = runSync('gitleaks', ['stdin', '--no-banner', '--redact', '--exit-code', '1'], {
        cwd: root,
        input: chunks,
        timeoutMs: 300_000,
      });
      if (r.code === 1) findings.push(`작업 트리 변경:\n${(r.stdout + r.stderr).trim()}`);
      else if (r.code !== 0) findings.push(`gitleaks 실행 오류(${r.code}): ${r.stderr.trim()}`);
    }
  }
  for (const f of findings) {
    problems.push({
      rule: 'R10 시크릿 검출',
      what: f.slice(0, 3000),
      how: 'push 전이면 값을 지우고 .env(무시됨)나 환경 변수로 옮겨라. 이미 push했다면 유출로 보고 즉시 키를 교체하라',
      doc: DOC,
    });
  }
  return problems;
}
