$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectDir
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js 24 이상을 설치하세요.' }
$major = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($major -lt 24) { throw 'Node.js 24 이상이 필요합니다.' }
$listener = Get-NetTCPConnection -State Listen -LocalPort 8765 -ErrorAction SilentlyContinue
if ($listener) {
  try {
    $session = Invoke-RestMethod 'http://127.0.0.1:8765/api/session'
    $health = Invoke-RestMethod 'http://127.0.0.1:8765/api/health' -Headers @{'X-Jipilsil-Token'=$session.token}
    if ($health.app -eq 'jipilsil-ai') { Start-Process 'http://127.0.0.1:8765/'; exit 0 }
  } catch {}
  throw '8765 포트를 다른 서버가 사용 중입니다. 기존 집필실 정적 서버 창을 종료한 뒤 다시 실행하세요. 주소는 원고 보존을 위해 변경하지 않습니다.'
}
if (-not (Test-Path -LiteralPath 'node_modules/ws')) { & npm.cmd ci --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { throw '의존성 설치 실패' } }
Start-Process 'http://127.0.0.1:8765/'
& node server/main.mjs
