#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
confirm(){ [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && return 0; printf "Quit Docker Desktop for runtime reset testing? [y/N] "; read -r a; case "$a" in y|Y|yes|YES) ;; *) exit 0;; esac; }

log "Docklite macOS Docker Desktop runtime reset"
confirm "${1:-}"
osascript -e 'quit app "Docker"' >/dev/null 2>&1 || true
ok "Docker Desktop quit. App data was not deleted."
