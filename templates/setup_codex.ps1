# One-time Codex CLI setup for VibeFoundry projects (Windows).
#
# Marks the workspace as trusted so Codex can run shell commands and
# edit files inside the project without prompting for approval on
# every command. The agent still pauses for plans and judgment-call
# questions — those are governed by AGENTS.md, not this config.
#
# Run once:   powershell -ExecutionPolicy Bypass -File app_folder\templates\setup_codex.ps1
# Re-run anytime — it's idempotent and backs up your existing config.

$ErrorActionPreference = "Stop"

$ConfigDir  = Join-Path $HOME ".codex"
$ConfigFile = Join-Path $ConfigDir "config.toml"
$BackupFile = Join-Path $ConfigDir "config.toml.bak"

if (-not (Test-Path $ConfigDir)) {
    New-Item -ItemType Directory -Path $ConfigDir | Out-Null
}

if (Test-Path $ConfigFile) {
    Copy-Item $ConfigFile $BackupFile -Force
    Write-Host "Backed up existing config to $BackupFile"
} else {
    New-Item -ItemType File -Path $ConfigFile | Out-Null
}

function Set-OrAppend($key, $value) {
    $content = Get-Content $ConfigFile -Raw
    $line = '{0} = "{1}"' -f $key, $value
    if ($content -match "(?m)^$key\s*=") {
        $content = $content -replace "(?m)^$key\s*=.*$", $line
        Set-Content -Path $ConfigFile -Value $content -NoNewline
    } else {
        Add-Content -Path $ConfigFile -Value $line
    }
}

$existing = Get-Content $ConfigFile -Raw
if ($existing -notmatch "Workspace is trusted") {
    Add-Content -Path $ConfigFile -Value ""
    Add-Content -Path $ConfigFile -Value "# Workspace is trusted — set by setup_codex.ps1"
}

Set-OrAppend "approval_policy" "never"
Set-OrAppend "sandbox_mode" "workspace-write"

Write-Host ""
Write-Host "Codex configured for trusted-workspace mode." -ForegroundColor Green
Write-Host "   Settings written to: $ConfigFile"
Write-Host "   Backup at:           $BackupFile"
Write-Host "   Restart Codex if it's running."
