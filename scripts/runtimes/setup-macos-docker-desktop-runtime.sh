#!/usr/bin/env bash
set -u

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }
run(){ log "$*"; "$@"; }

log "Docklite macOS Docker Desktop runtime setup"
[ "$(uname -s)" = "Darwin" ] || fail "This script is for macOS."
if [ -d "/Applications/Docker.app" ]; then ok "Docker Desktop app found"; else has brew || fail "Homebrew is required for automatic install."; warn "Docker Desktop not found"; run brew install --cask docker || fail "Could not install Docker Desktop."; fi
run open -a Docker || fail "Could not open Docker Desktop."
log "Waiting briefly for Docker Desktop daemon"
sleep 8
if docker info >/dev/null 2>&1; then ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."; else warn "Docker Desktop opened, but Docker is not reachable yet. Finish startup, then refresh Docklite."; fi
