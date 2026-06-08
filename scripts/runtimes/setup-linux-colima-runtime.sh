#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }
run(){ log "$*"; "$@"; }

log "Docklite Linux Colima runtime setup"
[ "$(uname -s)" = "Linux" ] || fail "This script is for Linux."
has colima || fail "Colima is not installed. Install Colima for Linux, then run this again."
has docker || fail "Docker CLI is not installed."
if colima status 2>/dev/null | grep -qi running; then ok "Colima is already running"; else run colima start || fail "Could not start Colima."; fi
if docker context inspect colima >/dev/null 2>&1; then run docker context use colima || warn "Could not switch Docker context to Colima."; fi
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable yet."
ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
