#!/usr/bin/env bash
# Codex 판정 샌드박스 사전 측정(10.4절 "Codex 샌드박스"). LLM 없이, 판정과 같은 설정($CODEX_HOME/config.toml)의
# 샌드박스에서 접근을 잰다. 값은 출력하지 않고 종료 코드만 출력한다. pr/에서 실행한다.
# 기대: pr/ 읽기만 된다(0). 쓰기 반영·인증 파일·RUNNER_TEMP·base/·홈 설정 읽기·환경 변수·조상 프로세스 환경·
# 네트워크·sudo는 안 된다(0이 아님). 하나라도 다르면 1로 끝나 판정 단계가 돌지 않는다.
# 필요한 환경 변수: CODEX_HOME, RUNNER_TEMP, HOME, HARNESS_PROBE_MARKER(비밀이 아닌 표식 값)
set -u
: "${CODEX_HOME:?}" "${RUNNER_TEMP:?}" "${HOME:?}" "${HARNESS_PROBE_MARKER:?}"
bad=0

# expect <이름> <allow|deny> <종료 코드>
expect() {
  local got=deny
  [ "$3" -eq 0 ] && got=allow
  if [ "$got" = "$2" ]; then
    echo "codex-probe: $1 exit=$3 (기대대로 $2)"
  else
    echo "codex-probe: $1 exit=$3 — 기대는 $2인데 $got"
    bad=1
  fi
}
probe() {
  codex sandbox -- sh -c "$3" >/dev/null 2>&1
  expect "$1" "$2" $?
}

# 홈 설정 폴더 읽기를 재려고 샌드박스 밖에서 빈 표식 파일을 둔다
mkdir -p "$HOME/.codex" "$HOME/.config"
: > "$HOME/.codex/harness-probe"
: > "$HOME/.config/harness-probe"

probe pr_read allow 'head -c1 .harness-review/context.md'
# 쓰기: 샌드박스 안에서 시도한 뒤, 샌드박스 밖에서 실제 pr/에 파일이 생겼는지 본다
codex sandbox -- sh -c 'echo x > .harness-probe-write' >/dev/null 2>&1
if [ -e .harness-probe-write ]; then
  rm -f .harness-probe-write
  expect pr_write_persisted deny 0
else
  expect pr_write_persisted deny 1
fi
probe tmp_write deny 'touch /tmp/harness-probe'
probe auth_read deny "head -c1 '$CODEX_HOME/auth.json'"
probe runner_temp_list deny "ls '$RUNNER_TEMP'"
probe home_codex_read deny "cat '$HOME/.codex/harness-probe'"
probe home_config_read deny "cat '$HOME/.config/harness-probe'"
probe base_read deny 'head -c1 ../base/scripts/cross-review/prompt.md'
# 샌드박스 명령의 환경 변수에 표식이 보이는지
probe env_marker deny 'env | grep -q "^HARNESS_PROBE_"'
# 조상 프로세스(codex 등)의 /proc/<pid>/environ에서 표식 값을 찾는다
probe proc_ancestor_environ deny 'p=$PPID; while [ "${p:-1}" -gt 1 ]; do grep -qa "'"$HARNESS_PROBE_MARKER"'" "/proc/$p/environ" 2>/dev/null && exit 0; p=$(cut -d" " -f4 "/proc/$p/stat" 2>/dev/null || echo 1); done; exit 1'
probe network deny 'curl -sS -m 5 -o /dev/null https://api.github.com'
probe sudo deny 'sudo -n true'

if [ "$bad" -ne 0 ]; then
  echo "codex-probe: 실패 — 샌드박스가 기대와 다르다. 판정을 실행하지 않는다"
  exit 1
fi
echo "codex-probe: 통과"
