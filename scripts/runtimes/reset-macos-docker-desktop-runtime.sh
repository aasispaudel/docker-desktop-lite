#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }

confirm(){
  [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && return 0
  printf "Quit Docker Desktop for runtime reset testing? [y/N] "
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) ok "Reset cancelled"; exit 0 ;;
  esac
}

log "Docklite macOS Docker Desktop runtime reset"
[ "$(uname -s)" = "Darwin" ] || fail "This script is for macOS."
confirm "${1:-}"

log "Quitting Docker Desktop"
osascript -e 'quit app "Docker"' >/dev/null 2>&1 || warn "Docker Desktop may already be closed."
ok "Docker Desktop quit. App data was not deleted."
