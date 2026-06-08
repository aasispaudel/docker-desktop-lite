$ErrorActionPreference = "Stop"

function Log($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "OK $message" -ForegroundColor Green }
function Warn($message) { Write-Host "WARN $message" -ForegroundColor Yellow }

Log "Docklite Windows Docker Desktop runtime setup"
$dockerDesktop = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerDesktop)) {
  Warn "Docker Desktop was not found. Opening Docker Desktop install page."
  Start-Process "https://www.docker.com/products/docker-desktop/"
  exit 1
}

Start-Process $dockerDesktop
Log "Waiting briefly for Docker Desktop daemon"
Start-Sleep -Seconds 10
try {
  docker info | Out-Null
  Ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
} catch {
  Warn "Docker Desktop opened, but Docker is not reachable yet. Finish startup, then refresh Docklite."
}
