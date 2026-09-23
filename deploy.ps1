param(
    [string]$Destination = (Join-Path $env:USERPROFILE 'Documents\ActivityWatch\okko-dashboard')
)
$ErrorActionPreference = 'Stop'
function Get-RuntimeHash([string]$Path) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path))) }
    finally { $sha.Dispose() }
}
$sourceRoot = [IO.Path]::GetFullPath($PSScriptRoot)
$targetRoot = [IO.Path]::GetFullPath($Destination)
if ($sourceRoot.TrimEnd('\') -eq $targetRoot.TrimEnd('\')) { throw 'Choose a deployment folder different from the repository.' }
if (Test-Path -LiteralPath (Join-Path $targetRoot '.git')) { throw 'Destination contains a Git repository; use a runtime-only folder.' }
$files = @('index.html','projects.html','projects.css','projects-app.mjs','projects-core.mjs','compact-rule-editor.mjs','rule-engine.mjs','rule-groups.mjs','manual-ui.mjs','time-charts.mjs','unassigned-core.mjs','unassigned-ui.mjs')
foreach ($file in $files) {
    if (!(Test-Path -LiteralPath (Join-Path $sourceRoot $file) -PathType Leaf)) { throw "Missing source file: $file" }
}
Push-Location $sourceRoot
try {
    node --test projects.test.mjs display-fixes.test.mjs unassigned.test.mjs advanced-rules.test.mjs compact-rules.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Tests failed; deployment cancelled.' }
} finally { Pop-Location }
$backupRoot = Join-Path (Split-Path $targetRoot -Parent) ('deployment-backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
New-Item -ItemType Directory -Path $targetRoot -Force | Out-Null
foreach ($file in $files) {
    $target = Join-Path $targetRoot $file
    if (Test-Path -LiteralPath $target) { Copy-Item -LiteralPath $target -Destination (Join-Path $backupRoot $file) }
}
foreach ($file in $files) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $file) -Destination (Join-Path $targetRoot $file) -Force
    if ((Get-RuntimeHash (Join-Path $sourceRoot $file)) -ne (Get-RuntimeHash (Join-Path $targetRoot $file))) { throw "Verification failed for $file. Previous files: $backupRoot" }
}
Write-Output "Deployed to: $targetRoot"
Write-Output "Previous runtime files: $backupRoot"
Write-Output 'ActivityWatch settings and recordings were not modified. Refresh the dashboard with Ctrl+F5.'
