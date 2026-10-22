param([switch]$SkipStart)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
function New-HexSecret([int]$Length) {
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)
  $rng.Dispose()
  return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}
if (-not (Test-Path '.env')) {
  $text = Get-Content '.env.example' -Raw
  $text = $text.Replace('replace-with-a-long-unique-password', (New-HexSecret 24))
  $text = $text.Replace('replace-with-64-random-hex-characters', (New-HexSecret 32))
  $text = $text.Replace('replace-with-another-64-random-hex-secret', (New-HexSecret 32))
  [System.IO.File]::WriteAllText((Join-Path $PSScriptRoot '.env'), $text, (New-Object System.Text.UTF8Encoding $false))
  Write-Host 'Created .env. ADMIN_PASSWORD is saved there. Keep this file private.'
}
if ($SkipStart) { exit 0 }
Get-Command docker -ErrorAction Stop | Out-Null
& docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop with Linux containers first.' }
& docker compose up -d --build
if ($LASTEXITCODE -ne 0) { throw 'Docker startup failed. Review the build logs.' }
Write-Host 'Nep Mail: http://localhost:3000'
Write-Host 'Local capture inbox: http://localhost:8025'
Write-Host 'No Internet email is enabled in this configuration.'
