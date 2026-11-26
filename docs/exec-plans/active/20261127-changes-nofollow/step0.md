# Step 0: nofollow

## 읽어야 할 파일

- 계획 `docs/exec-plans/active/20261127-changes-nofollow/plan.md`의 수용 기준과 의사결정 로그
- `scripts/commands/changes.ts`(전체. 특히 3번 파일 경계, 6번 읽기, 8번 쓰기·지우기의 `movedSince`·`step`)
- `scripts/test/changes-collect.test.ts`(`repo`, `snapshot`, `direct`, `tryLink`, 심볼릭 링크 테스트, F6 경쟁 테스트)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5). 되돌린 구현 커밋 `75a4a00`의 코드와 테스트를 출발점으로 쓴다.

1. **옵션과 고리**: `runChangesCollect`의 `o` 형에 `noFollow?: boolean`(기본 켬)과 `hooks?: { afterRead?: (rel: string) => void; beforeChange?: (rel: string) => void; beforeWrite?: (rel: string) => void }`. `CollectFs.writeFile(rel, text, fd)`는 논리 경로 `rel`(예: `docs/harness/CHANGELOG.md`)의 결과를 새 파일의 핸들 `fd`에 쓰는 함수이고 (ㄴ)과 게시 사이에 불린다(경로를 받지 않는다). `CollectFs.unlink(name)`은 작업 폴더 안의 임시 이름으로 불린다(이름 끝은 원래 이름). 있던 테스트의 쓰기 주입 콜백은 새 계약(핸들에 쓰고 `rel`로 대상을 가린다)으로 바꾸고 단언은 그대로 둔다.
2. **테스트**(`scripts/test/changes-collect.test.ts`): 계획 수용 기준 8의 (가)~(파2). 링크를 못 만드는 환경이면 그 경우를 건너뛰고, 작업 폴더인 폴더를 옮기지 못하는 플랫폼(Windows)이면 폴더를 옮기는 경우를 건너뛴다. (타) 밖의 각 경우는 종료 코드 1, 알림 문구, 리포 밖 파일 바이트(또는 남아 있음), 되돌리는 명령의 경로 목록(없으면 명령 줄이 없음)과 "자동으로 되돌리지 않는 파일"을 단언한다. (타)는 종료 코드 0, CHANGELOG에 그 조각의 항목, 조각 폴더가 빈 것을 단언한다. 수용 기준 8 끝의 변형 일곱으로 해당 테스트가 실패하는지 확인해 진행 로그에 적는다.
3. **구현**(`scripts/commands/changes.ts`):
   - 폴더 셋·파일의 식별자 기록, `openChecked`(`O_NOFOLLOW`·`O_NONBLOCK`, `fstat` 일반 파일·링크 수 1·식별자), 한 번 읽기(`readBytes`, `afterRead`)는 `75a4a00`대로.
   - `inDir(dirRel, fn)`: 폴더 셋 경로 확인 → 원래 작업 폴더 기억 → `process.chdir(abs(dirRel))` → `.`의 식별자 확인 → `fn()` → `finally`에서 원래 작업 폴더로.
   - `moveAside(rel, name)`: (ㄱ) 이름으로 `lstat` 식별자와 `openChecked` 내용 확인 → `beforeChange(rel)` → (ㄴ) `renameSync(name, 임시)` → (ㄷ) 임시 이름으로 `lstat` 식별자·`openChecked`(링크 수 1)·내용 확인. 어긋나면 `putBack` 뒤 던진다. 임시 이름을 돌려준다.
   - `putBack(rel, 임시, name, 원인)`: 임시가 심볼릭 링크면 `symlinkSync(readlinkSync(임시), name)`, 아니면 `linkSync(임시, name)` 뒤 `unlinkSync(임시)`. 실패하면 임시 이름에 남겼다는 오류.
   - 쓰기(`inDir('docs/harness', …)` 안에서 설계서·CHANGELOG): `moveAside` → 새 파일 `openSync(새 이름, O_WRONLY|O_CREAT|O_EXCL|NOFOLLOW, 원래 권한)`, 그 핸들의 `fstat` 식별자 기록 → `beforeWrite(rel)` → `fs.writeFile(rel, text, fd)`(기본: 위치를 주어 `writeSync`로 끝까지) → 닫기 → 새 이름의 `lstat` 식별자가 기록과 같음(아니면 새 이름을 지우지 않고 그대로 두고 `putBack` 뒤 멈춘다) → 목록에 넣음 → `linkSync(새 이름, name)`(이미 있으면 목록에서 빼고 새 파일을 지우고, 원래 파일을 임시 이름에 남긴 채 그 경로를 알린다) → 제자리 이름의 `lstat` 식별자가 기록과 같음(아니면 목록에서 빼고 "자동으로 되돌리지 않는 파일"로 알리고 멈춘다) → 게시한 식별자와 바이트 기록 → 새 이름·임시 이름 지우기. 쓰기 주입이 실패하면 새 파일을 지우고 `putBack`.
   - 지우기(`inDir(조각 폴더, …)`): 조각마다 `moveAside` → 목록에 넣음 → `fs.unlink(임시)`(실패하면 목록에서 빼고 `putBack`).
   - 끝난 뒤 폴더 셋을 경로로 다시 본다.
   - 알림(실패 때): 목록을 다시 본다(그 파일의 상위 폴더가 처음과 같고, 게시한 파일은 그 경로의 식별자가 게시한 것과 같고 링크를 따라가지 않고 연 핸들로 읽은 내용이 게시한 바이트와 같으며, 지운 조각은 그 경로에 아무것도 없음). 맞는 것만 되돌리는 명령에, 나머지는 "자동으로 되돌리지 않는 파일: …(그 뒤 다른 세션이 바꿨거나 폴더가 바뀌었다. 직접 확인하라)"로 알린다. 둘 다 비면 "아무 파일도 바꾸지 않았다".
4. **문서**: `docs/harness/architecture.md`의 `lib/changes.ts` 줄에 "한 번 읽은 바이트로 확인하고, 폴더를 작업 폴더로 고정해 원래 파일을 임시 이름으로 옮겨 다시 확인한 뒤 새 파일로 게시하거나 지운다. 되돌리는 명령은 알릴 때 다시 본다"를 더한다. 변경 조각 `docs/harness/changes/20261127-changes-nofollow-s0.md`(CHANGELOG 한 줄, `Issue #257`).

## Acceptance Criteria

```bash
node --test scripts/test/changes-collect.test.ts
grep -q "O_NOFOLLOW" scripts/commands/changes.ts
grep -q "O_NONBLOCK" scripts/commands/changes.ts
grep -q "process.chdir" scripts/commands/changes.ts
grep -q "O_EXCL" scripts/commands/changes.ts
grep -q "자동으로 되돌리지 않는 파일" scripts/commands/changes.ts
grep -q "처음 검사한 그 파일이 아니다" scripts/commands/changes.ts
grep -q "처음 검사한 그 폴더가 아니다" scripts/commands/changes.ts
grep -qF 'Issue #257' docs/harness/changes/20261127-changes-nofollow-s0.md
node scripts/harness.ts check
```

## 금지사항

- 있던 `changes-collect` 테스트의 단언을 약하게 하지 마라. 이유: R4.
- 링크·식별자를 확인하지 못했을 때 쓰거나 지우지 마라. 이유: 막는 쪽(fail-closed).
- `changes-collect` 밖의 명령을 고치지 마라. 이유: 범위.
