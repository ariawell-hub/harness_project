# Step 0: nofollow

## 읽어야 할 파일

- 계획 `docs/exec-plans/active/20261127-changes-nofollow/plan.md`의 수용 기준과 의사결정 로그
- `scripts/commands/changes.ts`(전체. 특히 3번 파일 경계, 6번 읽기, 8번 쓰기·지우기의 `movedSince`·`step`)
- `scripts/test/changes-collect.test.ts`(`repo`, `snapshot`, `direct`, `tryLink`, 심볼릭 링크 테스트, F6 경쟁 테스트)

## 작업

테스트를 먼저 쓰고, 구현 전에 실패하는 것을 확인해 진행 로그에 적는다(R5).

1. **옵션과 고리**: `runChangesCollect`의 `o` 형에 `noFollow?: boolean`(기본 켬)과 `hooks?: { afterRead?: (rel: string) => void; beforeChange?: (rel: string) => void }`를 더한다. `CollectFs.writeFile`의 형은 `(file: string, text: string, fd: number) => void`, `CollectFs.unlink`는 조각 폴더가 작업 폴더일 때 이름(`<조각 파일 이름>`)으로 불린다. 있던 테스트의 주입 함수는 그대로 동작해야 한다.
2. **테스트**(`scripts/test/changes-collect.test.ts`): 계획 수용 기준 7의 (가)~(자). 링크를 못 만드는 환경이면 `tryLink`로 그 경우를 건너뛴다(하드 링크 (다)와 (바)·(자)는 링크 없이 돈다). 각 경우 종료 코드 1, 알림 문구, 리포 밖 파일 바이트(또는 남아 있음), 되돌리는 명령의 경로 목록(없으면 명령 줄이 없음)을 단언한다.
3. **구현**(`scripts/commands/changes.ts`):
   - 1번 폴더 경계 때 폴더 셋의 `lstatSync(…, { bigint: true })` 식별자를, 3번 파일 경계 때 파일 식별자를 기록한다.
   - `openChecked(rel, flags)`: `openSync(abs, flags | NOFOLLOW | NONBLOCK)`(없는 상수는 0, `noFollow: false`면 `NOFOLLOW`는 0). 연 핸들의 `fstatSync(fd, { bigint: true })`가 일반 파일, 링크 수 1, 식별자 같음이 아니면 닫고 "그 파일이 아니다". 링크라 열리지 않거나(`ELOOP`, `EMLINK`) 없으면 같은 결과.
   - 3번 뒤(4번 전)에 일반 파일마다 `openChecked(rel, O_RDONLY)`로 한 번 읽어 `readBytes`에 두고 `hooks.afterRead(rel)`을 부른다. 4번 HEAD 확인과 6번 모으기는 이 바이트를 쓴다.
   - 쓰기: 폴더 셋 확인 → `openChecked(rel, O_RDWR)` → 그 핸들로 읽은 내용이 `readBytes`와 같음(아니면 "읽은 뒤 바뀌었다") → 되돌리기 목록에 넣음 → `hooks.beforeChange(rel)` → `fs.writeFile(abs, text, fd)`(기본: `ftruncateSync(fd, 0)` 뒤 위치를 주어 `writeSync`로 끝까지) → 닫기 → 경로 `lstat` 식별자와 폴더 셋 다시 확인.
   - 지우기: 원래 작업 폴더를 기억하고 `process.chdir(abs(조각 폴더))` → `.`의 `lstat` 식별자가 기록과 같음 → 조각마다 이름으로 `lstat` 식별자 확인, 이름으로 `openChecked`와 내용 확인, 목록에 넣음, `hooks.beforeChange(rel)`, `fs.unlink(이름)` → `finally`에서 원래 작업 폴더로. 이 동안 `abs()`를 쓰지 않는다. 모두 끝난 뒤 폴더 셋을 다시 본다.
   - 알림과 되돌리는 명령은 계획 수용 기준 4·5대로. 6번 읽기에서 바뀐 것이 걸리면(아직 아무것도 쓰지 않음) 같은 알림과 "아무 파일도 바꾸지 않았다".
4. **문서**: `docs/harness/architecture.md`의 `lib/changes.ts` 줄에서 명령 설명에 "한 번 읽은 바이트로 확인하고, 쓰기·지우기 직전에 파일·폴더 식별자를 확인해 연 핸들로 쓰고 조각 폴더 안에서 이름으로 지운다"를 더한다. 변경 조각 `docs/harness/changes/20261127-changes-nofollow-s0.md`(CHANGELOG 한 줄, `Issue #257`).

## Acceptance Criteria

```bash
node --test scripts/test/changes-collect.test.ts
grep -q "O_NOFOLLOW" scripts/commands/changes.ts
grep -q "O_NONBLOCK" scripts/commands/changes.ts
grep -q "process.chdir" scripts/commands/changes.ts
grep -q "처음 검사한 그 파일이 아니다" scripts/commands/changes.ts
grep -q "처음 검사한 그 폴더가 아니다" scripts/commands/changes.ts
grep -qF 'Issue #257' docs/harness/changes/20261127-changes-nofollow-s0.md
node scripts/harness.ts check
```

## 금지사항

- 있던 `changes-collect` 테스트의 단언을 약하게 하지 마라. 이유: R4.
- 링크·식별자를 확인하지 못했을 때 쓰거나 지우지 마라. 이유: 막는 쪽(fail-closed).
- `changes-collect` 밖의 명령을 고치지 마라. 이유: 범위.
