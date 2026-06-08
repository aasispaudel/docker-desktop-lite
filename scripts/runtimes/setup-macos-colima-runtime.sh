#!/usr/bin/env bash
set -u

COLIMA_CPU="${DOCKLITE_COLIMA_CPU:-2}"
COLIMA_MEMORY="${DOCKLITE_COLIMA_MEMORY:-4}"
COLIMA_DISK="${DOCKLITE_COLIMA_DISK:-60}"
COLIMA_TIMEOUT_SECONDS="${DOCKLITE_COLIMA_TIMEOUT_SECONDS:-600}"
COLIMA_PROFILE_DIR="$HOME/.colima/_lima/colima"

log(){ printf "\033[1;34m==>\033[0m %s\n" "$1"; }
ok(){ printf "\033[1;32mOK\033[0m %s\n" "$1"; }
warn(){ printf "\033[1;33mWARN\033[0m %s\n" "$1"; }
fail(){ printf "\033[1;31mERROR\033[0m %s\n" "$1" >&2; exit 1; }
has(){ command -v "$1" >/dev/null 2>&1; }
run(){ log "$*"; "$@"; }

confirm(){
  printf "%s [y/N] " "$1"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

run_with_timeout(){
  seconds="$1"
  shift

  "$@" &
  pid="$!"
  elapsed=0

  while kill -0 "$pid" >/dev/null 2>&1; do
    if [ "$elapsed" -ge "$seconds" ]; then
      warn "Command timed out after ${seconds}s: $*"
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" >/dev/null 2>&1 || true
      return 124
    fi

    sleep 2
    elapsed=$((elapsed + 2))
  done

  wait "$pid"
}

start_colima(){
  vm_type="$1"
  if [ -d "$COLIMA_PROFILE_DIR" ]; then
    log "Starting existing Colima profile"
    run_with_timeout "$COLIMA_TIMEOUT_SECONDS" colima start
  else
    log "Creating Colima profile with ${COLIMA_CPU} CPU, ${COLIMA_MEMORY}GiB memory, ${COLIMA_DISK}GiB disk"
    run_with_timeout "$COLIMA_TIMEOUT_SECONDS" colima start \
      --runtime docker \
      --cpu "$COLIMA_CPU" \
      --memory "$COLIMA_MEMORY" \
      --disk "$COLIMA_DISK" \
      --vm-type "$vm_type"
  fi
}

verify_docker(){
  log "Configuring Docker context"
  if docker context inspect colima >/dev/null 2>&1; then
    run docker context use colima || fail "Could not switch Docker context to Colima."
  else
    warn "Docker context 'colima' was not found yet."
  fi

  log "Verifying Docker daemon"
  docker info >/dev/null 2>&1
}

reset_colima(){
  warn "This removes the Colima VM and any containers/images/volumes stored inside it."
  confirm "Reset Colima VM and retry?" || return 1
  run colima stop >/dev/null 2>&1 || true
  run colima delete --force || fail "Could not delete the Colima VM."
  return 0
}

log "Docklite macOS Colima runtime setup"
[ "$(uname -s)" = "Darwin" ] || fail "This script is for macOS."

has brew || fail "Homebrew is required. Install Homebrew from https://brew.sh, then run this again."
ok "Homebrew found"

if has docker; then
  ok "Docker CLI found"
else
  warn "Docker CLI not found. Installing Docker CLI with Homebrew."
  run brew install docker || fail "Could not install Docker CLI."
fi

if has colima; then
  ok "Colima found"
else
  warn "Colima not found. Installing Colima with Homebrew."
  run brew install colima || fail "Could not install Colima."
fi

if colima status 2>/dev/null | grep -qi running; then
  ok "Colima is already running"
else
  if ! start_colima "vz"; then
    warn "Colima did not finish starting cleanly."
    warn "This often happens after an interrupted first run or a partial VM boot."

    if reset_colima; then
      if ! start_colima "vz"; then
        warn "Colima still did not start with Apple's vz backend."
        if confirm "Retry with QEMU backend instead?"; then
          run colima delete --force >/dev/null 2>&1 || true
          start_colima "qemu" || fail "Colima could not start with QEMU either."
        else
          fail "Colima runtime setup was not completed."
        fi
      fi
    else
      fail "Colima runtime setup was not completed."
    fi
  fi
fi

if verify_docker; then
  ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
else
  warn "Colima started, but Docker is not reachable yet."
  warn "Try: docker context use colima && docker info"
  fail "Docker daemon verification failed."
fi
