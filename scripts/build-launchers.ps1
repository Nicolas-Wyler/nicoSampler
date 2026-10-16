# Maintainer build only; no PowerShell script or compiler is needed by end users.
$ErrorActionPreference = 'Stop'
$releaseRoot = Split-Path -Parent $PSScriptRoot
$goTool = if ($env:GO_BIN) { $env:GO_BIN } else { 'go' }
Push-Location (Join-Path $releaseRoot 'tools/launcher')
$previousGoos = $env:GOOS; $previousGoarch = $env:GOARCH; $previousCgo = $env:CGO_ENABLED; $previousToolchain = $env:GOTOOLCHAIN
try {
    $env:GOTOOLCHAIN = 'local'
    & $goTool test ./...
    if ($LASTEXITCODE -ne 0) { throw 'Launcher tests failed.' }
    foreach ($target in @('darwin/arm64', 'darwin/amd64', 'windows/amd64', 'windows/arm64')) {
        $parts = $target.Split('/')
        $env:GOOS = $parts[0]; $env:GOARCH = $parts[1]; $env:CGO_ENABLED = '0'
        $directory = Join-Path $releaseRoot "portable/bin/$($parts[0])-$($parts[1])"
        New-Item -ItemType Directory -Force $directory | Out-Null
        $extension = if ($parts[0] -eq 'windows') { '.exe' } else { '' }
        & $goTool build -trimpath -buildvcs=false '-ldflags=-s -w -buildid=' -o (Join-Path $directory "nicoSampler-server$extension") .
        if ($LASTEXITCODE -ne 0) { throw "Build failed for $target" }
    }
    Copy-Item Start.command, Start.cmd (Join-Path $releaseRoot 'portable')
    $licenseDirectory = Join-Path $releaseRoot 'portable/third-party/go'
    New-Item -ItemType Directory -Force $licenseDirectory | Out-Null
    $goRoot = (& $goTool env GOROOT).Trim()
    Copy-Item (Join-Path $goRoot 'LICENSE'), (Join-Path $goRoot 'PATENTS') $licenseDirectory
    Get-ChildItem (Join-Path $goRoot 'src/vendor/golang.org/x/*/LICENSE') | ForEach-Object {
        Copy-Item $_.FullName (Join-Path $licenseDirectory "golang.org-x-$($_.Directory.Name)-LICENSE")
    }
    & $goTool version | Set-Content (Join-Path $licenseDirectory 'TOOLCHAIN.txt')
    Copy-Item 'licenses/GO-NOTICE.txt' (Join-Path $licenseDirectory 'NOTICE.txt')
} finally {
    $env:GOOS = $previousGoos; $env:GOARCH = $previousGoarch; $env:CGO_ENABLED = $previousCgo; $env:GOTOOLCHAIN = $previousToolchain
    Pop-Location
}
Write-Host 'Built portable/bin servers. Preserve executable permissions for Start.command when packaging on macOS.'
