@AGENTS.md

# Claude Code 전용 사항

- **훅**: `.claude/settings.json`의 PreToolUse 훅이 모든 Bash·Read·Edit·Write 호출을 `scripts/hooks/guard.ts`로 검사한다. 차단되면 메시지의 "고치는 법"을 따른다. 훅을 끄거나 우회하지 않는다(R4).
- **무인 실행**: runner는 `claude -p --permission-mode dontAsk`와 무인 권한 프로필(`.claude/runner-settings.json`)로 세션을 띄운다. 허용되지 않은 도구는 묻지 않고 거부된다. push·PR은 runner가 한다.
- **자동 메모리는 끈다**: 리포 밖에 남는 지시 경로이기 때문이다. 알게 된 것은 계획의 "발견 사항"이나 `docs/`에 적는다(B1).
- **서브에이전트**: 로컬 사전 점검용으로 자유롭게 쓴다. 병합 판단에는 CI 검증 결과만 쓴다(2단계부터).
