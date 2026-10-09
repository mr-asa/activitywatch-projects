# Installs or updates the Projects dashboard for ActivityWatch (Windows).
#   irm https://github.com/mr-asa/activitywatch-projects/releases/latest/download/install.ps1 | iex
# The same script is the updater: the dashboard's "Update" button runs it through
# the awprojects:// protocol it registers (current user only, no admin rights).
# It only touches %LOCALAPPDATA%\ActivityWatchProjects and aw-server.toml
# (one added line, backed up first); ActivityWatch data and settings are never modified.
param(
    [switch]$Update,
    [string]$ZipSource = 'https://github.com/mr-asa/activitywatch-projects/releases/latest/download/activitywatch-projects.zip',
    [string]$BaseDir = (Join-Path $env:LOCALAPPDATA 'ActivityWatchProjects'),
    [string]$ConfigPath = (Join-Path $env:LOCALAPPDATA 'activitywatch\activitywatch\aw-server\aw-server.toml'),
    [switch]$NoProtocol
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$appDir = Join-Path $BaseDir 'app'
$log = Join-Path $BaseDir 'install.log'
function Say([string]$Message) {
    if (!$Update) { Write-Host $Message }
    New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
    Add-Content -LiteralPath $log -Value ("{0:s} {1}" -f (Get-Date), $Message)
}
function Get-Sha256([string]$Path) {
    (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Fetch([string]$Source, [string]$Target) {
    if ($Source -match '^https?://') { Invoke-WebRequest -Uri $Source -OutFile $Target -UseBasicParsing }
    else { Copy-Item -LiteralPath $Source -Destination $Target }
}
function Set-AwStatic {
    $folder = $appDir.Replace('\', '/')
    $line = "projects = `"$folder`""
    $configDir = Split-Path $ConfigPath -Parent
    if (!(Test-Path -LiteralPath $configDir)) {
        Say "ActivityWatch config folder not found. Add this to aw-server.toml yourself:`n[server.custom_static]`n$line"
        return $false
    }
    $text = if (Test-Path -LiteralPath $ConfigPath) { Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 } else { '' }
    if ($text -match "(?m)^\s*projects\s*=\s*`"([^`"]*)`"") {
        if ($Matches[1] -ne $folder) { Say "aw-server.toml already has 'projects = $($Matches[1])'. Left unchanged; point it to $folder to use this install." }
        return $false
    }
    if (Test-Path -LiteralPath $ConfigPath) {
        Copy-Item -LiteralPath $ConfigPath -Destination ($ConfigPath + '.bak-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    }
    $header = [regex]::Match($text, '(?m)^\[server\.custom_static\][ \t]*\r?$')
    if ($header.Success) {
        $text = $text.Insert($header.Index + $header.Length, "`r`n$line")
    } else {
        $text = $text.TrimEnd() + "`r`n`r`n[server.custom_static]`r`n$line`r`n"
    }
    [IO.File]::WriteAllText($ConfigPath, $text, (New-Object Text.UTF8Encoding($false)))
    Say "Added '$line' to $ConfigPath"
    return $true
}
function Register-UpdateProtocol {
    $root = 'HKCU:\Software\Classes\awprojects'
    $command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $BaseDir 'install.ps1')`" -Update"
    New-Item -Path "$root\shell\open\command" -Force | Out-Null
    Set-ItemProperty -Path $root -Name '(default)' -Value 'URL:ActivityWatch Projects updater'
    Set-ItemProperty -Path $root -Name 'URL Protocol' -Value ''
    Set-ItemProperty -Path "$root\shell\open\command" -Name '(default)' -Value $command
}
$work = Join-Path ([IO.Path]::GetTempPath()) ('awprojects-' + [guid]::NewGuid().ToString('N'))
try {
    New-Item -ItemType Directory -Path $work | Out-Null
    $zip = Join-Path $work 'release.zip'
    Fetch $ZipSource $zip
    Fetch ($ZipSource + '.sha256') ($zip + '.sha256')
    $expected = ((Get-Content -LiteralPath ($zip + '.sha256') -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
    if ((Get-Sha256 $zip) -ne $expected) { throw 'Download is corrupted (SHA-256 mismatch). Nothing was changed.' }
    $unpacked = Join-Path $work 'unpacked'
    Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
    foreach ($required in 'app\index.html', 'app\version.json', 'install.ps1') {
        if (!(Test-Path -LiteralPath (Join-Path $unpacked $required))) { throw "Release is missing $required. Nothing was changed." }
    }
    $new = (Get-Content -LiteralPath (Join-Path $unpacked 'app\version.json') -Raw | ConvertFrom-Json).version
    $old = $null
    $oldFile = Join-Path $appDir 'version.json'
    if (Test-Path -LiteralPath $oldFile) { $old = (Get-Content -LiteralPath $oldFile -Raw | ConvertFrom-Json).version }
    New-Item -ItemType Directory -Path $BaseDir -Force | Out-Null
    $previous = Join-Path $BaseDir 'app-previous'
    $moved = $false
    if (Test-Path -LiteralPath $appDir) {
        if (Test-Path -LiteralPath $previous) { Remove-Item -LiteralPath $previous -Recurse -Force }
        Move-Item -LiteralPath $appDir -Destination $previous
        $moved = $true
    }
    try { Move-Item -LiteralPath (Join-Path $unpacked 'app') -Destination $appDir }
    catch {
        if ($moved) { Move-Item -LiteralPath $previous -Destination $appDir }
        throw
    }
    $self = Join-Path $BaseDir 'install.ps1'
    $incoming = Join-Path $unpacked 'install.ps1'
    if (!(Test-Path -LiteralPath $self) -or (Get-Sha256 $self) -ne (Get-Sha256 $incoming)) {
        try { Copy-Item -LiteralPath $incoming -Destination $self -Force } catch { Say "Could not refresh install.ps1: $($_.Exception.Message)" }
    }
    if (!$NoProtocol) { Register-UpdateProtocol }
    if ($old) { Say "Updated $old -> $new ($appDir)" } else { Say "Installed $new ($appDir)" }
    if (!$Update) {
        $configured = Set-AwStatic
        Write-Host ''
        if ($configured) { Write-Host 'Restart ActivityWatch once so it picks up the new page.' }
        Write-Host 'Open http://127.0.0.1:5600/pages/projects/ (Ctrl+F5 after updates).'
    }
} catch {
    Say "FAILED: $($_.Exception.Message)"
    if (!$Update) { throw }
} finally {
    if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue }
}
