$ErrorActionPreference = "Continue"
function Log($message) { Write-Host "==> $message" -ForegroundColor Cyan }
function Ok($message) { Write-Host "OK $message" -ForegroundColor Green }

Log "Docklite Windows WSL2 Docker runtime reset"
if ($args[0] -ne "--yes" -and $args[0] -ne "-y") {
  $answer = Read-Host "Stop Docker inside the default WSL distro? [y/N]"
  if ($answer -notin @("y", "Y", "yes", "YES")) { exit 0 }
}
wsl.exe -e sh -lc "sudo service docker stop || sudo systemctl stop docker || true"
Ok "WSL2 Docker reset complete"
