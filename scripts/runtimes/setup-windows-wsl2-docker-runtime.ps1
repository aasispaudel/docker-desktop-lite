$ErrorActionPreference = "Stop"

$TimeoutSeconds = if ($Env:DOCKLITE_WSL_DOCKER_TIMEOUT_SECONDS) { [int]$Env:DOCKLITE_WSL_DOCKER_TIMEOUT_SECONDS } else { 180 }

function Log($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "OK $message" -ForegroundColor Green }
function Warn($message) { Write-Host "WARN $message" -ForegroundColor Yellow }
function Fail($message) { Write-Host "ERROR $message" -ForegroundColor Red; exit 1 }
function HasCommand($name) { return $null -ne (Get-Command $name -ErrorAction SilentlyContinue) }

function Wait-DockerDaemon {
  $elapsed = 0
  while ($elapsed -lt $TimeoutSeconds) {
    try {
      docker info *> $null
      return $true
    } catch {
      Start-Sleep -Seconds 2
      $elapsed += 2
      Write-Host -NoNewline "."
    }
  }

  Write-Host ""
  return $false
}

function Run-WslShell($command) {
  Log "wsl.exe -e sh -lc $command"
  wsl.exe -e sh -lc $command
  if ($LASTEXITCODE -ne 0) {
    Fail "WSL command failed."
  }
}

Log "Docklite Windows WSL2 Docker Engine runtime setup"

if (-not (HasCommand "wsl.exe")) {
  Fail "WSL is not installed. Install WSL2 first, then run this script again."
}
Ok "WSL found"

$distros = @(wsl.exe -l -q | Where-Object { $_.Trim().Length -gt 0 })
if ($distros.Count -eq 0) {
  Fail "No WSL distributions found. Install a Linux distro with WSL2 first."
}
Ok "WSL distro found: $($distros[0])"

if (-not (HasCommand "docker.exe")) {
  Warn "Docker CLI was not found on Windows PATH. Docklite needs docker.exe reachable from VS Code."
}

$startScript = @'
if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed inside WSL." >&2
  exit 1
fi

if docker info >/dev/null 2>&1; then
  exit 0
fi

if command -v systemctl >/dev/null 2>&1; then
  sudo systemctl start docker || true
fi

if ! docker info >/dev/null 2>&1 && command -v service >/dev/null 2>&1; then
  sudo service docker start || true
fi

docker info >/dev/null 2>&1
'@

Log "Starting Docker inside the default WSL distro"
Run-WslShell $startScript

Log "Waiting for Docker daemon"
if (Wait-DockerDaemon) {
  Ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
} else {
  Warn "Docker started inside WSL, but docker.exe is not reachable from Windows."
  Warn "Check Docker context and WSL integration, then refresh Docklite."
  Fail "Docker daemon verification failed."
}
