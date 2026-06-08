#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }
run(){ log "$*"; "$@"; }

log "Docklite Linux Docker Engine runtime setup"
[ "$(uname -s)" = "Linux" ] || fail "This script is for Linux."
has docker || fail "Docker CLI is not installed. Install Docker Engine for your distro, then run this again."
has systemctl || fail "systemctl is not available. Start your Docker daemon manually, then refresh Docklite."

if docker info >/dev/null 2>&1; then ok "Docker daemon is already reachable"; exit 0; fi
if systemctl is-active --quiet docker; then ok "docker.service is already active"; else run sudo systemctl start docker || fail "Could not start docker.service."; fi
docker info >/dev/null 2>&1 || fail "Docker daemon is not reachable. Check Docker permissions or add your user to the docker group."
ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
