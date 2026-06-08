#!/usr/bin/env bash
set -u

DOCKER_DESKTOP_TIMEOUT_SECONDS="${DOCKLITE_DOCKER_DESKTOP_TIMEOUT_SECONDS:-600}"
DOCKER_APP_PATH="/Applications/Docker.app"

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }
run(){ log "$*"; "$@"; }

wait_for_docker(){
  elapsed=0
  while [ "$elapsed" -lt "$DOCKER_DESKTOP_TIMEOUT_SECONDS" ]; do
    if docker info >/dev/null 2>&1; then
      return 0
    fi

    sleep 3
    elapsed=$((elapsed + 3))
    printf "."
  done

  printf "\n"
  return 1
}

use_desktop_context_if_present(){
  if docker context inspect desktop-linux >/dev/null 2>&1; then
    run docker context use desktop-linux || warn "Could not switch Docker context to desktop-linux."
  fi
}

log "Docklite macOS Docker Desktop runtime setup"
[ "$(uname -s)" = "Darwin" ] || fail "This script is for macOS."

if has docker; then
  ok "Docker CLI found"
else
  warn "Docker CLI not found. Docker Desktop includes one, but Docklite cannot verify Docker until it is available on PATH."
fi

if [ -d "$DOCKER_APP_PATH" ]; then
  ok "Docker Desktop app found"
else
  warn "Docker Desktop app not found."
  has brew || fail "Homebrew is required for automatic Docker Desktop install. Install Docker Desktop manually or install Homebrew from https://brew.sh."
  run brew install --cask docker || fail "Could not install Docker Desktop."
fi

run open -a Docker || fail "Could not open Docker Desktop."

log "Waiting for Docker Desktop daemon"
if wait_for_docker; then
  use_desktop_context_if_present
  ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
else
  warn "Docker Desktop opened, but the daemon did not become reachable within ${DOCKER_DESKTOP_TIMEOUT_SECONDS}s."
  warn "Finish any first-run prompts, accept required terms, then refresh Docklite."
  fail "Docker daemon verification failed."
fi
