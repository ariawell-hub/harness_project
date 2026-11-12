# Step 4: cli-help-messages

## 읽어야 할 파일

- `docs/exec-plans/active/20261112-stop-friction/plan.md`
- `scripts/harness.ts` (`HELP`, `main`, `parseArgs` 옵션)
- `scripts/hooks/rules.ts` (`evaluateFile`의 리포 밖 R3 메시지, step0에서 바꾼 판정 순서)
- `scripts/test/guard.test.ts`, `scripts/test/` 안에서 `harness.ts`를 subprocess로 부르는 테스트
- `docs/exec-plans/tech-debt-tracker.md` TD-17

## 작업

배경: `node scripts/harness.ts run --help`가 도움말 대신 runner를 시작해 Issue #4를 선점했다(TD-17, `parseArgs`가 `strict: false`라 모르는 플래그를 무시한다). 리포 밖 파일(`~/.config/harness/bot.env`, `~/.zshrc`)을 막을 때도 "현재 worktree 안의 파일만 고쳐라"라고 안내해 사용자가 "R3가 무엇인가"를 물었다.

1. `scripts/harness.ts`
   - `--` 앞 인자에 `--help` 또는 `-h`가 있으면 어떤 명령도 실행하지 않고 `HELP`를 출력하고 0으로 끝난다.
   - `--` 앞 인자의 `--이름`(`--이름=값` 포함)이 정의된 옵션이 아니면 실행하지 않고 `알 수 없는 옵션: --이름`과 `HELP`를 stderr로 출력하고 2로 끝난다.
2. `scripts/hooks/rules.ts`: 대상이 어떤 리포에도 속하지 않거나 다른 리포인 경우의 R3 메시지를 바꾼다.
   - 무엇: `리포 밖 파일을 수정하려 했다: <경로>`
   - 고치는 법: `리포 밖(사용자 환경·다른 프로젝트) 파일은 에이전트가 고치지 않는다. 바꿀 내용과 사용자가 직접 실행할 명령("! <명령>")을 안내하라`
   - 규칙 이름은 `R3 worktree` 그대로 둔다.
3. 테스트
   - subprocess: `run --help`, `new-task --help`가 0으로 끝나고 도움말을 출력하며 리포가 아닌 임시 폴더에서도 오류가 없다(실행하지 않았다는 증거). `run --bogus`는 2로 끝나고 `알 수 없는 옵션`을 출력한다.
   - 훅: 홈 아래 파일 쓰기 메시지에 `리포 밖`과 `! <명령>`이 있다.
4. `docs/exec-plans/tech-debt-tracker.md` TD-17 상태를 해결로 바꾸고 근거(#16)를 적는다. `docs/harness/CHANGELOG.md` "다음 버전"에 한 줄.
5. 마지막 step이므로 계획 "검증 방법과 결과"·"다음 할 일"을 마무리한다.

## Acceptance Criteria

```bash
node --test scripts/test/guard.test.ts
node scripts/harness.ts run --help | grep -q "하네스 명령"
! node scripts/harness.ts run --bogus-flag 2>/dev/null
node scripts/harness.ts check
```

## 금지사항

- `parseArgs`를 `strict: true`로 바꾸지 마라. 이유: 명령마다 받는 옵션이 달라 위치 인자·`--` 뒤 인자 처리가 깨질 수 있다. 모르는 `--이름`만 직접 확인한다.
- 리포 밖 쓰기를 허용 쪽으로 바꾸지 마라. 이유: 메시지만 바꾸는 step이다.
