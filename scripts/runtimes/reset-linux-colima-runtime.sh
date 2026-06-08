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
  warn "This removes the Colima VM and any containers/images/volumes stored inside it."
  printf "Stop and delete Colima VM/data? [y/N] "
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) ok "Reset cancelled"; exit 0 ;;
  esac
}

log "Docklite Linux Colima runtime reset"
[ "$(uname -s)" = "Linux" ] || fail "This script is for Linux."
confirm "${1:-}"

if has docker && [ "$(docker context show 2>/dev/null || true)" = "colima" ]; then
  run docker context use default >/dev/null 2>&1 || warn "Could not switch Docker context to default."
fi

if has colima; then
  run colima stop >/dev/null 2>&1 || true
  run colima delete --force || warn "Colima may already be deleted."
else
  warn "Colima is not installed."
fi

ok "Colima reset complete"
