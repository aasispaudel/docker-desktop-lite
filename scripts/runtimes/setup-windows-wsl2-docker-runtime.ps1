$ErrorActionPreference = "Stop"

function Log($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "OK $message" -ForegroundColor Green }
function Warn($message) { Write-Host "WARN $message" -ForegroundColor Yellow }

Log "Docklite Windows WSL2 Docker Engine runtime setup"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  throw "WSL is not installed. Install WSL2 first, then run this script again."
}

$distros = wsl.exe -l -q
if (-not $distros) {
  throw "No WSL distributions found. Install a Linux distro with WSL2 first."
}

Log "Starting Docker inside the default WSL distro"
wsl.exe -e sh -lc "if command -v docker >/dev/null 2>&1; then sudo service docker start || sudo systemctl start docker; else echo 'Docker is not installed inside WSL.' >&2; exit 1; fi"

Log "Verifying Docker daemon"
docker info | Out-Null
Ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
