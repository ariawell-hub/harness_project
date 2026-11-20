## Codex 실행 환경

- 셸 명령은 파일을 읽는 데만 써라(`cat`, `sed -n`, `rg`, `ls`, `head`, `wc`). 아무것도 쓰거나 지우거나 실행하지 마라.
- 작업 폴더 안의 파일만 읽어라. 작업 폴더 밖의 경로, 환경 변수(`env`, `printenv`), 인증 정보(`auth.json` 등)는 읽거나 출력하지 마라. 네트워크에 접속하지 마라.
- 길이 제한: `summary` 1000자, `findings` 30개, 지적마다 `file` 300자, `title` 200자, `evidence` 1500자, `suggestion` 1000자, `repro`의 `path` 200자·`content` 4000자(재현 테스트는 판정 하나에 3개까지), `resolutions` 60개, `resolutions`마다 `note` 300자. 넘으면 판정 전체가 버려진다.
