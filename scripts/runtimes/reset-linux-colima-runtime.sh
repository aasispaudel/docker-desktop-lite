#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
has(){ command -v "$1" >/dev/null 2>&1; }
confirm(){ [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && return 0; printf "Stop and delete Colima VM/data? [y/N] "; read -r a; case "$a" in y|Y|yes|YES) ;; *) exit 0;; esac; }

log "Docklite Linux Colima runtime reset"
confirm "${1:-}"
if has docker && [ "$(docker context show 2>/dev/null || true)" = "colima" ]; then docker context use default >/dev/null 2>&1 || warn "Could not switch Docker context to default."; fi
if has colima; then colima stop >/dev/null 2>&1 || true; colima delete --force >/dev/null 2>&1 || warn "Colima may already be deleted."; else warn "Colima not installed."; fi
ok "Colima reset complete"
