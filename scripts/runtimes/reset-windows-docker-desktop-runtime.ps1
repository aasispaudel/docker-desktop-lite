$ErrorActionPreference = "Continue"
function Log($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "OK $message" -ForegroundColor Green }

Log "Docklite Windows Docker Desktop runtime reset"
if ($args[0] -ne "--yes" -and $args[0] -ne "-y") {
  $answer = Read-Host "Quit Docker Desktop? [y/N]"
  if ($answer -notin @("y", "Y", "yes", "YES")) { exit 0 }
}
Get-Process "Docker Desktop" -ErrorAction SilentlyContinue | Stop-Process
Ok "Docker Desktop quit. App data was not deleted."
