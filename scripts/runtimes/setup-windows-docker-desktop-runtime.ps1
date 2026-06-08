$ErrorActionPreference = "Stop"

$TimeoutSeconds = if ($Env:DOCKLITE_DOCKER_DESKTOP_TIMEOUT_SECONDS) { [int]$Env:DOCKLITE_DOCKER_DESKTOP_TIMEOUT_SECONDS } else { 600 }

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
      Start-Sleep -Seconds 3
      $elapsed += 3
      Write-Host -NoNewline "."
    }
  }

  Write-Host ""
  return $false
}

function Use-DesktopContextIfPresent {
  try {
    docker context inspect desktop-linux *> $null
    docker context use desktop-linux | Out-Host
  } catch {
    Warn "Could not switch Docker context to desktop-linux, or the context does not exist yet."
  }
}

Log "Docklite Windows Docker Desktop runtime setup"

if (-not (HasCommand "docker.exe")) {
  Warn "Docker CLI was not found on PATH. Docker Desktop should add it after install/start."
} else {
  Ok "Docker CLI found"
}

$dockerDesktop = Join-Path $Env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerDesktop)) {
  Warn "Docker Desktop was not found."
  Warn "Opening Docker Desktop install page. Install it, then run Configure Runtime again."
  Start-Process "https://www.docker.com/products/docker-desktop/"
  Fail "Docker Desktop is not installed."
}

Ok "Docker Desktop app found"
Log "Starting Docker Desktop"
Start-Process $dockerDesktop

Log "Waiting for Docker Desktop daemon"
if (Wait-DockerDaemon) {
  Use-DesktopContextIfPresent
  Ok "Docker daemon is now running. Refresh Docklite to load containers, images, and volumes."
} else {
  Warn "Docker Desktop opened, but the daemon did not become reachable within ${TimeoutSeconds}s."
  Warn "Finish any first-run prompts, accept required terms, then refresh Docklite."
  Fail "Docker daemon verification failed."
}
