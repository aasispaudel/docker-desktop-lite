$ErrorActionPreference = "Continue"

function Log($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "OK $message" -ForegroundColor Green }
function Warn($message) { Write-Host "WARN $message" -ForegroundColor Yellow }

function Confirm-Reset {
  if ($args[0] -eq "--yes" -or $args[0] -eq "-y") { return $true }
  Warn "Running containers inside the default WSL Docker daemon will stop."
  $answer = Read-Host "Stop Docker inside the default WSL distro? [y/N]"
  return $answer -in @("y", "Y", "yes", "YES")
}

Log "Docklite Windows WSL2 Docker runtime reset"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
  Warn "WSL is not installed."
  exit 0
}

if (-not (Confirm-Reset $args[0])) {
  Ok "Reset cancelled"
  exit 0
}

Log "Stopping Docker inside the default WSL distro"
wsl.exe -e sh -lc "sudo service docker stop || sudo systemctl stop docker || true"
Ok "WSL2 Docker reset complete"
