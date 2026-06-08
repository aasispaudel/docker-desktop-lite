#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
confirm(){ [ "${1:-}" = "--yes" ] || [ "${1:-}" = "-y" ] && return 0; printf "Stop docker.service? Running containers will stop. [y/N] "; read -r a; case "$a" in y|Y|yes|YES) ;; *) exit 0;; esac; }

log "Docklite Linux Docker Engine runtime reset"
confirm "${1:-}"
sudo systemctl stop docker || warn "Could not stop docker.service."
ok "Docker Engine reset complete"
