# Windows preflight: installs Java 17, Node 22 and Google Chrome via winget,
# then runs the repo setup and environment check.
#
# Run BEFORE the workshop, on good wifi, in Windows PowerShell or PowerShell 7:
#   powershell -ExecutionPolicy Bypass -File scripts\preflight-windows.ps1
#
# Safe to re-run: every step is skipped if already satisfied.

$ErrorActionPreference = 'Continue'

$JavaPackage = 'Microsoft.OpenJDK.17'
$NodePackage = 'OpenJS.NodeJS.LTS'

function Write-Bold($msg) { Write-Host $msg -ForegroundColor White }
function Write-Ok($msg)   { Write-Host "  ok   $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  ..   $msg" -ForegroundColor DarkGray }
function Write-Warn($msg) { Write-Host "  warn $msg" -ForegroundColor Yellow }
function Write-Die($msg)  { Write-Host "  FAIL $msg" -ForegroundColor Red; exit 1 }

Set-Location (Join-Path $PSScriptRoot '..')

# Re-read PATH from the registry. winget updates the machine/user PATH but the
# current session does not see it, which otherwise breaks the later steps.
function Update-SessionPath {
    $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $user = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machine;$user"
}

function Get-CommandVersionMajor($exe, $pattern) {
    if (-not (Get-Command $exe -ErrorAction SilentlyContinue)) { return $null }
    $output = & $exe $args 2>&1 | Out-String
    if ($output -match $pattern) { return [int]$Matches[1] }
    return $null
}

Write-Bold "0/5  winget"
if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Ok "available"
} else {
    Write-Die @"
winget not found. Install "App Installer" from the Microsoft Store, then re-run.
Alternative: install these three manually and then run 'npm ci; npm run setup':
  - Java 17  https://learn.microsoft.com/java/openjdk/download
  - Node 22  https://nodejs.org/en/download
  - Chrome   https://www.google.com/chrome/
"@
}

Write-Bold "1/5  Java 17 (needed only because the Grid hub and nodes are Java processes)"
$javaMajor = $null
if (Get-Command java -ErrorAction SilentlyContinue) {
    $javaOut = (java -version 2>&1 | Out-String)
    if ($javaOut -match 'version "(\d+)') { $javaMajor = [int]$Matches[1] }
}
if ($javaMajor -ne $null -and $javaMajor -ge 11) {
    Write-Ok "Java $javaMajor already on PATH (11+ is enough)"
} else {
    Write-Info "installing $JavaPackage"
    winget install --id $JavaPackage --accept-source-agreements --accept-package-agreements --silent
    Update-SessionPath
    if (-not (Get-Command java -ErrorAction SilentlyContinue)) {
        Write-Die "Java installed but not on PATH. Close this window, open a new PowerShell, and re-run."
    }
    Write-Ok ((java -version 2>&1 | Select-Object -First 1) -join '')
}

Write-Bold "2/5  Node.js 22"
$nodeMajor = $null
if (Get-Command node -ErrorAction SilentlyContinue) {
    if ((node -v) -match 'v(\d+)') { $nodeMajor = [int]$Matches[1] }
}
if ($nodeMajor -ne $null -and $nodeMajor -ge 20) {
    Write-Ok "Node $(node -v) already installed (20+ is enough)"
} else {
    Write-Info "installing $NodePackage"
    winget install --id $NodePackage --accept-source-agreements --accept-package-agreements --silent
    Update-SessionPath
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Die "Node installed but not on PATH. Close this window, open a new PowerShell, and re-run."
    }
    Write-Ok "Node $(node -v)"
}

Write-Bold "3/5  Google Chrome"
$chromePaths = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
if ($chromePaths | Where-Object { Test-Path $_ }) {
    Write-Ok "already installed"
} else {
    Write-Info "installing Google Chrome"
    winget install --id Google.Chrome --accept-source-agreements --accept-package-agreements --silent
    Write-Ok "installed"
}

Write-Bold "4/5  tar (used to unpack Prometheus)"
if (Get-Command tar -ErrorAction SilentlyContinue) {
    Write-Ok "available"
} else {
    Write-Warn "tar not found. It ships with Windows 10 1803+. 'npm run setup' will tell you how to unpack Prometheus by hand."
}

Write-Bold "5/5  Project dependencies and tooling"
Write-Info "npm ci"
npm ci
Write-Info "npm run setup (downloads the Selenium jar, Prometheus and Chromium)"
npm run setup

Write-Host ""
Write-Bold "Preflight done - running the environment check"
npm run doctor
