<#
.REEL
Read-only local Windows operator Launchpad for REEL Pilot 001.
This script does NOT download anything, install modules, modify execution policy,
start the CineSwarm coordinator, connect to the Internet or render GPU media.

Use from a deliberate local checkout:
  .\tools\REEL-Launchpad.ps1
  .\tools\REEL-Launchpad.ps1 -PilotPath "$HOME\Downloads\reel-p001-preproduction.json"
  .\tools\REEL-Launchpad.ps1 -CheckModelHash -ProbeTorch -SaveReport

Requires Python 3.11+. It loads the existing CineSwarm source from ./src
in this process without performing pip install.
#>
[CmdletBinding()]
param(
    [string]$PilotPath,
    [switch]$CheckModelHash,
    [switch]$ProbeTorch,
    [switch]$SaveReport
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$src = Join-Path $root 'src'
$modulePath = Join-Path $src 'cineswarm\reel_launchpad.py'
if (-not (Test-Path -LiteralPath $modulePath -PathType Leaf)) {
    throw 'CineSwarm launchpad source is missing in this local checkout.'
}

$pythonCommand = Get-Command 'python' -ErrorAction SilentlyContinue
$runner = @()
if ($pythonCommand) {
    $runner = @($pythonCommand.Source)
} else {
    $pyLauncher = Get-Command 'py' -ErrorAction SilentlyContinue
    if ($pyLauncher) {
        $runner = @($pyLauncher.Source, '-3')
    } else {
        throw 'Python 3.11+ was not found. Install Python from its official source and try again.'
    }
}

Write-Host 'REEL ORIGINALS  //  SHOT 001 LOCAL LAUNCHPAD' -ForegroundColor Cyan
Write-Host 'READ-ONLY DIAGNOSTIC. No model downloads. No GPU rendering. No uploads.'
Write-Host ('Repository: ' + $root)
Write-Host ''

# Avoid per-machine installation just to inspect the existing checkout.
$previousPythonPath = [Environment]::GetEnvironmentVariable('PYTHONPATH','Process')
if ([string]::IsNullOrEmpty($previousPythonPath)) {
    $env:PYTHONPATH = $src
} else {
    $env:PYTHONPATH = $src + [System.IO.Path]::PathSeparator + $previousPythonPath
}

try {
    $arguments = @()
    if ($runner.Length -gt 1) {
        $arguments += $runner[1..($runner.Length - 1)]
    }
    $arguments += @('-m', 'cineswarm.reel_launchpad')

    if (-not $PilotPath) {
        $candidate = Join-Path $HOME 'Downloads\reel-p001-preproduction.json'
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            $PilotPath = $candidate
            Write-Host ('Found optional downloaded REEL pilot: ' + $candidate)
        } else {
            Write-Host 'No pilot JSON selected. Machine-only diagnostics remain available.'
            Write-Host 'Export the pilot from REEL Network and rerun -PilotPath with its actual location.'
        }
    }
    if ($PilotPath) {
        if (-not (Test-Path -LiteralPath $PilotPath -PathType Leaf)) {
            throw ('Pilot JSON was not found: ' + $PilotPath)
        }
        $arguments += @('--pilot', (Resolve-Path -LiteralPath $PilotPath).Path)
    }
    if ($CheckModelHash) {
        Write-Host 'Opt-in: checkpoint directory bytes will be hashed. This may take time.'
        $arguments += '--check-model-hash'
    }
    if ($ProbeTorch) {
        Write-Host 'Opt-in: PyTorch CUDA visibility will be inspected, without inference.'
        $arguments += '--probe-torch'
    }
    if ($SaveReport) {
        $downloads = Join-Path $HOME 'Downloads'
        if (-not (Test-Path -LiteralPath $downloads -PathType Container)) {
            throw ('Downloads directory not found: ' + $downloads)
        }
        $filename = 'REEL-P001-Local-Diagnostic-' + [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff') + '.json'
        $arguments += @('--out', (Join-Path $downloads $filename))
    }
    $exe = $runner[0]
    & $exe @arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
        throw ('Launchpad diagnostics exited with code ' + $exitCode)
    }
} finally {
    [Environment]::SetEnvironmentVariable('PYTHONPATH', $previousPythonPath, 'Process')
}

Write-Host ''
Write-Host 'Diagnostics finished. No render was started.' -ForegroundColor Green
Write-Host 'For a real shot, review the separate local-render guide and use the explicit approved render command.'
