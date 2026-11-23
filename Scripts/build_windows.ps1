Param(
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $PSScriptRoot

Write-Host "[1/3] Compiling React Frontend..."
Push-Location (Join-Path $RootDir "frontend")
npm install --no-audit --no-fund
npm run build
Pop-Location

$EmbedDir = Join-Path $RootDir "pkg\embed\frontend_dist"
if (Test-Path $EmbedDir) { Remove-Item "$EmbedDir\*" -Recurse -Force }
Copy-Item -Path (Join-Path $RootDir "frontend\dist\*") -Destination $EmbedDir -Recurse -Force

Write-Host "[2/3] Running Go Tests..."
Push-Location $RootDir
go test -v ./...

Write-Host "[3/3] Building dicebound-windows-amd64.exe..."
New-Item -ItemType Directory -Force -Path (Join-Path $RootDir "dist\bin") | Out-Null
$env:CGO_ENABLED = "0"
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -trimpath -ldflags="-s -w -X main.version=$Version" -o (Join-Path $RootDir "dist\bin\dicebound-windows-amd64.exe") .\cmd\app
Pop-Location

Write-Host "[OK] Built dist\bin\dicebound-windows-amd64.exe"
