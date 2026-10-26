param()
$ErrorActionPreference = "Stop"
$exe = Join-Path $PSScriptRoot "..\desktop_agent.net\Hasu.DesktopAgent\bin\Debug\net10.0\Hasu.DesktopAgent.exe"
if (-not (Test-Path -LiteralPath $exe)) {
  dotnet build (Join-Path $PSScriptRoot "..\desktop_agent.net\Hasu.DesktopAgent\Hasu.DesktopAgent.csproj") -c Debug
}
$proc = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
try {
  $ready = $false
  for ($i = 0; $i -lt 50; $i++) {
    try { $h = Invoke-RestMethod -Uri "http://127.0.0.1:8765/health" -TimeoutSec 2; if ($h.status -eq "ok") { $ready = $true; break } } catch {}
    Start-Sleep -Milliseconds 200
  }
  if (-not $ready) { throw "sidecar did not become healthy" }
  $res = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/execute" -ContentType "application/json" -Body '{"tool":"systemInfo","args":{}}'
  if (-not $res.ok) { throw "systemInfo failed" }
  $clip = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/execute" -ContentType "application/json" -Body '{"tool":"setClipboard","args":{"text":"DOTNET_SMOKE_TEST"}}'
  if (-not $clip.ok) { throw "setClipboard failed" }
  $got = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:8765/execute" -ContentType "application/json" -Body '{"tool":"getClipboard","args":{}}'
  if ($got.result.text -ne "DOTNET_SMOKE_TEST") { throw "clipboard mismatch" }
  Write-Host "dotnet sidecar smoke test: PASS"
} finally {
  Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
}
