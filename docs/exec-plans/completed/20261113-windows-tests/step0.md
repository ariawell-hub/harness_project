# Step 0: windows-tests

## 읽어야 할 파일

- `docs/decisions/ADR-0005-windows-native.md` (개발용 `.env` 연결: 심볼릭 링크 → 하드 링크)
- `.gitattributes` (`* text=auto eol=lf`)
- `scripts/test/helpers.ts` `makeFixture`
- `scripts/test/start.test.ts` "fastForwardMain: 원격이 앞서면 당긴다 (a)"
- `scripts/test/task.test.ts` "linkFile: …", `scripts/commands/task.ts` `linkFile`
- `scripts/test/guard.test.ts` "파일 도구: …", `scripts/hooks/rules.ts`의 `rm` 판정

## 작업

1. `makeFixture`가 하네스 리포 루트의 `.gitattributes`를 fixture 리포에 복사해 첫 커밋에 넣는다. fixture를 clone한 리포도 LF로 체크아웃된다.
2. linkFile 테스트: 같은 임시 폴더에서 `symlinkSync`로 심볼릭 링크를 만들 수 있는지 먼저 확인한다. 가능하면 기본 연산 결과가 `symlink`이고 `lstat`이 심볼릭 링크인지, 아니면 결과가 `hardlink`이고 원본과 inode가 같은지 확인한다. 주입한 연산으로 대체 순서를 확인하는 나머지 단언은 그대로 둔다.
3. guard 테스트: `rm -rf ${wt}`를 `rm -rf '${wt}'`로 바꾼다. 같은 테스트의 다른 단언은 바꾸지 않는다.
4. 고치기 전에 Windows에서 세 테스트가 실패하는 기록, 고친 뒤 통과하는 기록을 진행 로그에 남긴다.

## Acceptance Criteria

```bash
node --test scripts/test/start.test.ts scripts/test/task.test.ts scripts/test/guard.test.ts
```

## 금지사항

- 테스트를 건너뛰거나(`skip`, 플랫폼 분기로 단언 생략) 단언을 지우지 마라. 이유: R4. 원래 확인하던 동작은 그대로 확인해야 한다.
- 하네스 동작 코드(`scripts/commands/`, `scripts/hooks/`, `scripts/lib/`)를 고치지 마라. 이유: 원인은 테스트 쪽이고 동작은 맞다(계획 진행 로그).
- 사용자 환경(PATH, git 전역 설정, 개발자 모드)을 바꾸지 마라. 이유: R3, 제작자가 직접 한다.
