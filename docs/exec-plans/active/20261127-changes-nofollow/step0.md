# Step 0: nofollow

## 읽어야 할 파일

- 계획 `docs/exec-plans/active/20261127-changes-nofollow/plan.md`의 수용 기준과 의사결정 로그
- `scripts/commands/changes.ts`(전체. 특히 3번 파일 경계, 6번 읽기, 8번 쓰기·지우기의 `movedSince`·`step`)
- `scripts/test/changes-collect.test.ts`(`repo`, `snapshot`, `direct`, `tryLink`, 심볼릭 링크 테스트, F6 경쟁 테스트)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **테스트**(`scripts/test/changes-collect.test.ts`에 새 `test` 하나 또는 둘): 조각 A·B가 있는 임시 리포에서 `direct`의 `fs.writeFile` 주입으로 설계서를 쓴 직후(또는 CHANGELOG를 쓴 직후) 아래를 만든다. 링크를 못 만드는 환경이면 `tryLink`로 그 경우를 건너뛴다.
   - (가) CHANGELOG를 지우고 같은 바이트를 담은 리포 밖 파일로 가는 심볼릭 링크로 바꾼다. 기대: 1, 출력에 `CHANGELOG.md: 처음 검사한 그 파일이 아니다`, 리포 밖 파일 바이트 그대로, 되돌리는 명령의 경로는 설계서 하나. 같은 경우를 `noFollow: false` 옵션으로 한 번 더 한다(Windows 경로).
   - (나) `docs/harness`를 옆으로 옮기고(`renameSync`) 같은 바이트의 설계서·CHANGELOG·조각 사본이 든 리포 밖 폴더로 가는 링크를 그 자리에 둔다. 기대: 1, 출력에 `docs/harness: 처음 검사한 그 폴더가 아니다`, 리포 밖 사본 모두 그대로.
   - (다) CHANGELOG에 리포 밖 이름의 하드 링크를 더한다. 기대: 1, 리포 밖 이름의 바이트 그대로.
   - (라) CHANGELOG를 쓴 직후 `docs/harness/changes`를 옆으로 옮기고 같은 이름·바이트의 조각이 든 리포 밖 폴더로 가는 링크를 둔다. 기대: 1, 출력에 `docs/harness/changes: 처음 검사한 그 폴더가 아니다`, 리포 밖 조각 둘 다 남아 있다.
2. **구현**(`scripts/commands/changes.ts`):
   - 1번 폴더 경계와 3번 파일 경계에서 `lstatSync(…, { bigint: true })`의 dev·ino를 기록한다(폴더 셋: `docs`, `docs/harness`, 조각 폴더. 파일: 설계서, CHANGELOG, 조각).
   - `openChecked(rel, flags)`: `openSync(abs, flags | NOFOLLOW)`(`NOFOLLOW`는 `fs.constants.O_NOFOLLOW ?? 0`, 옵션 `noFollow: false`면 0). 연 핸들의 `fstatSync(fd, { bigint: true })`가 일반 파일이고 링크 수 1이고 dev·ino가 기록과 같지 않으면 닫고 "그 파일이 아니다". 링크라 열리지 않으면(`ELOOP`, 일부 플랫폼 `EMLINK`) 같은 결과.
   - 6번 읽기를 `openChecked(rel, O_RDONLY)`로 열어 그 핸들로 읽는다.
   - 8번 `step` 직전마다 폴더 셋의 `lstat` 식별자가 기록과 같고 실제 폴더인지 본다.
   - 쓰기: `openChecked(rel, O_RDWR)` → 그 핸들로 읽은 바이트가 처음 읽은 바이트와 같은지(아니면 지금의 "읽은 뒤 바뀌었다") → `fs.writeFile(abs, text, fd)`. 기본 `writeFile`은 `ftruncateSync(fd, 0)` 뒤 `writeSync(fd, text, 0)`. 핸들은 `finally`에서 닫는다.
   - 지우기: `lstat` 식별자 확인 → `openChecked(rel, O_RDONLY)`로 읽은 바이트 확인 → 닫고 `fs.unlink(abs)`.
   - 출력: 파일이 바뀌었으면 `<경로>: 처음 검사한 그 파일이 아니다(링크나 다른 파일로 바뀌었거나 하드 링크가 생겼다). 건드리지 않고 그대로 두었다`, 폴더면 `<폴더>: 처음 검사한 그 폴더가 아니다(링크나 다른 폴더로 바뀌었다). 건드리지 않고 그대로 두었다`와 "그 폴더를 제자리에 돌려놓은 뒤 되돌리는 명령을 실행하라". 되돌리는 명령 규칙은 지금과 같다.
   - `CollectFs.writeFile`의 형은 `(file: string, text: string, fd: number) => void`로 넓힌다. 있던 테스트의 주입 함수(인자 둘)는 그대로 둔다.
3. **문서**: `docs/harness/architecture.md`의 `lib/changes.ts` 줄에서 명령 설명에 "쓰기·지우기 직전에 파일·폴더 식별자를 확인하고 연 핸들로 쓴다"를 더한다. 변경 조각 `docs/harness/changes/20261127-changes-nofollow-s0.md`(CHANGELOG 한 줄, `Issue #257`).

## Acceptance Criteria

```bash
node --test scripts/test/changes-collect.test.ts
grep -q "O_NOFOLLOW" scripts/commands/changes.ts
grep -q "처음 검사한 그 파일이 아니다" scripts/commands/changes.ts
grep -q "처음 검사한 그 폴더가 아니다" scripts/commands/changes.ts
grep -qF 'Issue #257' docs/harness/changes/20261127-changes-nofollow-s0.md
node scripts/harness.ts check
```

## 금지사항

- 있던 `changes-collect` 테스트의 단언을 약하게 하지 마라. 이유: R4.
- 링크·식별자를 확인하지 못했을 때 쓰거나 지우지 마라. 이유: 막는 쪽(fail-closed).
- `changes-collect` 밖의 명령을 고치지 마라. 이유: 범위.
