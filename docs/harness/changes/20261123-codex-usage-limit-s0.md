# 변경 조각: 20261123-codex-usage-limit-s0

## CHANGELOG

- Codex 사용 한도의 이유와 풀리는 시각(Issue #223, TD-50 해결. 검사를 약화하지 않는다: 상태는 그대로 error이고 다시 실행하지 않는다): `codex-scan`은 마지막 `turn.failed`가 사용 한도면 새 옵션 `--unavailable-out <파일>`에 정한 형식의 값(`usage-limit`, `usage-limit@YYYY-MM-DDTHH:MMZ`. 문구의 시각을 UTC로 읽는다)만 쓰고 지금처럼 판정 없이 종료 코드 1로 끝난다(`scripts/ci/codex-scan.ts`의 `usageLimitOutput`, `isUnavailableValue`). 새 명령 `codex-unavailable --file <파일>`이 그 값을 형식 검사해 `GITHUB_OUTPUT`에 `unavailable=`로 쓴다(언제나 종료 코드 0). `record-review --unavailable <값>`은 판정이 없을 때만 값을 다시 검사해 `review/codex` 설명에 `판정 없음: 검증자 사용 한도(풀림 … UTC). 풀린 뒤 판정 워크플로를 다시 실행한다`(시각을 모르면 "풀리는 시각 모름")를 적는다. runner의 CI 대기 알림은 그 설명을 읽어(`scripts/ci/record.ts`의 `usageLimitOf`) 추천을 "풀리는 시각 뒤에 다시 실행", "한도가 풀렸는지 확인한 뒤 다시 실행", 지금 글 가운데 하나로 적는다. 오류 문구 원문은 job 출력·커밋 상태에 넣지 않는다. 워크플로 `judge-codex.yml`의 변경(`scan` 명령의 인자, 새 단계 `why`, `judge` job 출력 `unavailable`, `record-review`의 인자)은 제작자가 올린다(패치 `lab/codex-usage-limit/judge-codex.patch`). Claude 판정 job의 한도(TD-70)와 Claude 판정 job의 허용 밖 `Bash` 호출(TD-71)을 기술 부채로 남겼다.

## 설계서 변경 이력

- 10.1절 "검증자 장애"에 사용 한도는 다시 돌리지 않고 Codex 판정 job이 한도를 알리면 `review/codex` 설명과 runner 알림에 이유와 풀리는 시각을 적는다는 항목을, 10.4절 "판정 job 안의 유출 검사"에 한도 값을 넘기는 길(파일 → `why` 단계 → 판정 job 출력 `unavailable` → 기록 job의 재검사)을 더했다. 상태와 검증 규칙은 바꾸지 않았다(Issue #223, TD-50 해결)
