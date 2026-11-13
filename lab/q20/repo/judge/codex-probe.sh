#!/usr/bin/env bash
# Q20 judge-codex(계획 20261111-q20-lab step5): LLM 없이 판정과 같은 설정($CODEX_HOME/config.toml)의 샌드박스에서
# 접근을 잰다. 값은 출력하지 않고 종료 코드만 출력한다. pr/에서 실행한다. 항상 종료 코드 0으로 끝난다.
#   기대: pr_read=0, 나머지는 0이 아님(proc_ancestor_environ는 1 = 조상 프로세스의 환경 변수를 읽지 못함)
set -u
probe() {
  codex sandbox -- sh -c "$2" >/dev/null 2>&1
  echo "Q20 probe $1 exit=$?"
}
probe pr_read 'head -c1 README.md'
probe pr_write 'touch .q20-probe'
probe tmp_write 'touch /tmp/q20-probe'
probe auth_read "head -c1 '$CODEX_HOME/auth.json'"
probe runner_temp_list "ls '$RUNNER_TEMP'"
probe home_list "ls '$HOME'"
probe base_read 'head -c1 ../base/judge/codex-prompt.md'
# 샌드박스 명령의 환경 변수에 Q20_* (표식·미끼)가 보이는지. 0이면 보였다
probe env_q20 'env | grep -q "^Q20_"'
# 조상 프로세스(codex 등)의 /proc/<pid>/environ에서 표식 값(비밀 아님)을 찾는다. 0이면 읽혔다
probe proc_ancestor_environ 'p=$PPID; while [ "${p:-1}" -gt 1 ]; do grep -qa q20-probe-marker-value "/proc/$p/environ" 2>/dev/null && exit 0; p=$(cut -d" " -f4 "/proc/$p/stat" 2>/dev/null || echo 1); done; exit 1'
probe network 'curl -sS -m 5 -o /dev/null https://api.github.com'
probe sudo 'sudo -n true'
exit 0
