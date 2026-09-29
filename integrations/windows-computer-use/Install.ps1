# Installs an optional Windows MCP sidecar. It does not modify UnrealCode settings
# or start the server; project trust and tool grants stay in the app.
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'UnrealCode\Addons\WindowsComputerUse')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$version = '1.3.25'
$assetName = "windows-mcp-server-$version-win-x64.zip"
$exeName = 'Sbroenne.WindowsMcp.exe'
$archiveHash = 'F9BC55661593AF5CBB0BE338EF6AD0D4D2F2668319748BE1BFBD46684A080A51'
$exeHash = '7049ACB6583F69EFB287916EB2D745ABACFA7A731640A6CCEF538ADEB33B2716'
$downloadUrl = "https://github.com/sbroenne/mcp-windows/releases/download/v$version/$assetName"
$toolNames = @(
    'window_management', 'ui_snapshot', 'ui_find', 'ui_click', 'ui_type',
    'ui_select', 'ui_read', 'ui_wait', 'screenshot_control',
    'keyboard_control', 'mouse_control'
) -join ','

function Assert-Hash {
    param([string]$Path, [string]$Expected)
    $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
    if ($actual -ne $Expected) {
        throw "SHA-256 verification failed for $(Split-Path -Leaf $Path). The file was not installed."
    }
}

function Show-ConnectionSetup {
    param([string]$Executable)
    $argumentsJson = ConvertTo-Json -InputObject @('--tools', $toolNames) -Compress
    Write-Output "Installed Windows computer-use MCP $version at:"
    Write-Output $Executable
    Write-Output 'In UnrealCode: Connections > Add connection > Windows - stdio.'
    Write-Output "Executable: $Executable"
    Write-Output "Arguments (JSON array): $argumentsJson"
    Write-Output 'Save, grant each trusted project access, connect, then select the tools it may use.'
}

if ($env:OS -ne 'Windows_NT' -or -not [Environment]::Is64BitOperatingSystem) {
    throw 'This pinned add-on requires 64-bit Windows.'
}
if ([string]::IsNullOrWhiteSpace($InstallRoot)) {
    throw 'Choose an installation directory.'
}

$root = [IO.Path]::GetFullPath($InstallRoot)
$versionDirectory = Join-Path $root "v$version"
$executable = Join-Path $versionDirectory $exeName
if (Test-Path -LiteralPath $executable -PathType Leaf) {
    Assert-Hash $executable $exeHash
    Show-ConnectionSetup $executable
    return
}
if (Test-Path -LiteralPath $versionDirectory -PathType Leaf) {
    throw "The version path is a file: $versionDirectory"
}
if (Test-Path -LiteralPath $versionDirectory -PathType Container) {
    if (Get-ChildItem -LiteralPath $versionDirectory -Force | Select-Object -First 1) {
        throw "The version directory already exists without a verified executable: $versionDirectory"
    }
}

New-Item -ItemType Directory -Path $root -Force | Out-Null
$stage = Join-Path $root ("stage-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$archivePath = Join-Path $stage $assetName
$extractDirectory = Join-Path $stage 'payload'
$stagedExe = Join-Path $extractDirectory $exeName
$pendingExe = $null

try {
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
    Assert-Hash $archivePath $archiveHash

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
    try {
        $entries = @($zip.Entries)
        if ($entries.Count -ne 1 -or $entries[0].FullName -cne $exeName -or
            $entries[0].Length -ne 59890504) {
            throw 'The verified archive has an unexpected layout.'
        }
    } finally {
        $zip.Dispose()
    }

    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDirectory
    Assert-Hash $stagedExe $exeHash
    if (-not (Test-Path -LiteralPath $versionDirectory -PathType Container)) {
        New-Item -ItemType Directory -Path $versionDirectory | Out-Null
    }
    $pendingExe = Join-Path $versionDirectory ($exeName + '.' + [guid]::NewGuid().ToString('N') + '.tmp')
    Copy-Item -LiteralPath $stagedExe -Destination $pendingExe
    Assert-Hash $pendingExe $exeHash
    Move-Item -LiteralPath $pendingExe -Destination $executable
    Show-ConnectionSetup $executable
} finally {
    foreach ($file in @($archivePath, $stagedExe, $pendingExe)) {
        if ($file -and (Test-Path -LiteralPath $file -PathType Leaf)) {
            Remove-Item -LiteralPath $file -Force
        }
    }
    foreach ($directory in @($extractDirectory, $stage)) {
        if ((Test-Path -LiteralPath $directory -PathType Container) -and
            -not (Get-ChildItem -LiteralPath $directory -Force | Select-Object -First 1)) {
            Remove-Item -LiteralPath $directory -Force
        }
    }
}
