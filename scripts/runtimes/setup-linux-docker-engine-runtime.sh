#!/usr/bin/env bash
set -u

DOCKER_ENGINE_TIMEOUT_SECONDS="${DOCKLITE_DOCKER_ENGINE_TIMEOUT_SECONDS:-120}"

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }
run(){ log "$*"; "$@"; }

wait_for_docker(){
  elapsed=0
  while [ "$elapsed" -lt "$DOCKER_ENGINE_TIMEOUT_SECONDS" ]; do
    if docker info >/dev/null 2>&1; then
      return 0
    fi

    sleep 2
    elapsed=$((elapsed + 2))
    printf "."
  done

  printf "\n"
  return 1
}

log "Docklite Linux Docker Engine runtime setup"
[ "$(uname -s)" = "Linux" ] || fail "This script is for Linux."

has docker || fail "Docker CLI is not installed. Install Docker Engine for your distro, then run this again."
ok "Docker CLI found"

if docker info >/dev/null 2>&1; then
  ok "Docker daemon is already reachable"
  ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
  exit 0
fi

has systemctl || fail "systemctl is not available. Start your Docker daemon manually, then refresh Docklite."
ok "systemctl found"

if systemctl is-active --quiet docker; then
  ok "docker.service is already active"
else
  run sudo systemctl start docker || fail "Could not start docker.service."
fi

log "Waiting for Docker daemon"
if wait_for_docker; then
  ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
else
  warn "docker.service is active, but Docker is not reachable from this user."
  warn "This usually means your user needs Docker socket permission."
  warn "Try: sudo usermod -aG docker \$USER"
  warn "Then log out and back in before refreshing Docklite."
  fail "Docker daemon verification failed."
fi
