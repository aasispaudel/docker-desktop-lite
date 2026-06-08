#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }
run(){ log "$*"; "$@"; }

confirm(){
  [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && return 0
  warn "Running containers managed by the system Docker daemon will stop."
  printf "Stop docker.service? [y/N] "
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) ok "Reset cancelled"; exit 0 ;;
  esac
}

log "Docklite Linux Docker Engine runtime reset"
[ "$(uname -s)" = "Linux" ] || fail "This script is for Linux."
has systemctl || fail "systemctl is not available. Stop Docker manually for this runtime."
confirm "${1:-}"

run sudo systemctl stop docker || warn "Could not stop docker.service."
ok "Docker Engine reset complete"
