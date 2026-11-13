#!/usr/bin/env bash
# Q20 judge-codex(계획 20261111-q20-lab step5): LLM 없이 판정과 같은 설정($CODEX_HOME/config.toml)의 샌드박스에서
# 접근을 잰다. 값은 출력하지 않고 종료 코드만 출력한다. pr/에서 실행한다. 항상 종료 코드 0으로 끝난다.
# 기대(Linux): pr_read=0(읽혀야 한다), 나머지는 0이 아님. pr_write_persisted는 샌드박스가 실제 pr/에 쓰지 못하면 1.
set -u
probe() {
  codex sandbox -- sh -c "$2" >/dev/null 2>&1
  echo "Q20 probe $1 exit=$?"
}
probe pr_read 'head -c1 README.md'
# 쓰기: 샌드박스 안에서 시도한 뒤, 샌드박스 밖에서 실제 pr/에 파일이 생겼는지 본다. 없으면(막혔으면) exit=1
codex sandbox -- sh -c 'echo x > .q20-probe-write' >/dev/null 2>&1
if [ -f .q20-probe-write ]; then rm -f .q20-probe-write; echo "Q20 probe pr_write_persisted exit=0"; else echo "Q20 probe pr_write_persisted exit=1"; fi
probe tmp_write 'touch /tmp/q20-probe'
probe auth_read "head -c1 '$CODEX_HOME/auth.json'"
probe runner_temp_list "ls '$RUNNER_TEMP'"
probe codex_home_read "head -c1 '$HOME/.codex/auth.json'"
probe base_read 'head -c1 ../base/judge/codex-prompt.md'
# 샌드박스 명령의 환경 변수에 Q20_* (표식·미끼)가 보이는지. 0이면 보였다
probe env_q20 'env | grep -q "^Q20_"'
# 조상 프로세스(codex 등)의 /proc/<pid>/environ에서 표식 값(비밀 아님)을 찾는다. 0이면 읽혔다
probe proc_ancestor_environ 'p=$PPID; while [ "${p:-1}" -gt 1 ]; do grep -qa q20-probe-marker-value "/proc/$p/environ" 2>/dev/null && exit 0; p=$(cut -d" " -f4 "/proc/$p/stat" 2>/dev/null || echo 1); done; exit 1'
probe network 'curl -sS -m 5 -o /dev/null https://api.github.com'
probe sudo 'sudo -n true'
exit 0
