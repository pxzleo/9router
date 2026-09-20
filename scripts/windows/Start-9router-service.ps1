param(
  [Parameter(Mandatory = $true)][string]$DataDir,
  [int]$Port = 20128
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$appDir = Join-Path $repoRoot 'cli\app'
$server = Join-Path $appDir 'custom-server.js'
$node = 'C:\Program Files\nodejs\node.exe'

if (-not (Test-Path -LiteralPath $node -PathType Leaf)) { throw "Node.js not found: $node" }
if (-not (Test-Path -LiteralPath $server -PathType Leaf)) { throw "9Router server not found: $server" }
if (-not (Test-Path -LiteralPath $DataDir -PathType Container)) { throw "9Router data directory not found: $DataDir" }

$env:PORT = [string]$Port
$env:HOSTNAME = '0.0.0.0'
$env:DATA_DIR = $DataDir
$env:ENABLE_REQUEST_LOGS = 'true'
Set-Location -LiteralPath $appDir
& $node $server
if ($LASTEXITCODE -ne 0) { throw "9Router exited with code $LASTEXITCODE" }
