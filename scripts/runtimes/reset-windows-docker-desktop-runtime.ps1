$ErrorActionPreference = "Continue"

function Log($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "OK $message" -ForegroundColor Green }
function Warn($message) { Write-Host "WARN $message" -ForegroundColor Yellow }

function Confirm-Reset {
  if ($args[0] -eq "--yes" -or $args[0] -eq "-y") { return $true }
  $answer = Read-Host "Quit Docker Desktop? [y/N]"
  return $answer -in @("y", "Y", "yes", "YES")
}

Log "Docklite Windows Docker Desktop runtime reset"

if (-not (Confirm-Reset $args[0])) {
  Ok "Reset cancelled"
  exit 0
}

Log "Quitting Docker Desktop"
Get-Process "Docker Desktop" -ErrorAction SilentlyContinue | Stop-Process
Get-Process "com.docker.backend" -ErrorAction SilentlyContinue | Stop-Process
Ok "Docker Desktop quit. App data was not deleted."
