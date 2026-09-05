# BUILD STUDIO 확장 — VSIX 포장 + 설치 프로그램(exe) 빌드
#
#   powershell -ExecutionPolicy Bypass -File installer\build.ps1
#
# 결과물은 Z:\AI_Storage\Project_Folder\BUILD-STUDIO-release\ 에 떨어집니다.

$ErrorActionPreference = "Stop"

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Split-Path -Parent $here
$release = Join-Path (Split-Path -Parent $project) "BUILD-STUDIO-release"

$node = "C:\Program Files\nodejs\node.exe"
$vsce = "C:\Users\super\AppData\Local\npm-cache\_npx\66fbc91407e86cd3\node_modules\@vscode\vsce\vsce"
$iscc = "C:\Users\super\AppData\Local\Programs\Inno Setup 6\ISCC.exe"

foreach ($tool in @($node, $iscc)) {
  if (-not (Test-Path $tool)) { throw "찾지 못했습니다: $tool" }
}

New-Item -ItemType Directory -Force $release | Out-Null

# 1. 문법 검사
Write-Host "[1/4] 문법 검사"
foreach ($js in @("extension.js", "mockup.js", "status.js", "engines.js")) {
  & $node --check (Join-Path $project $js)
  if (-not $?) { throw "$js 문법 오류" }
}

# 2. 설치 프로그램 아이콘 (확장 아이콘에서 생성)
Write-Host "[2/4] 설치 프로그램 아이콘"
& $node (Join-Path $here "make-setup-icon.mjs") `
    (Join-Path $project "media\icon-gallery.png") `
    (Join-Path $here "setup-icon.ico")

# 3. VSIX 포장
Write-Host "[3/4] VSIX 포장"
$version = (Get-Content (Join-Path $project "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json).version
$vsix = Join-Path $release "buildstudio-$version.vsix"
Push-Location $project
try { & $node $vsce package --out $vsix --no-dependencies } finally { Pop-Location }

# 4. 설치 프로그램 컴파일
Write-Host "[4/4] 설치 프로그램 컴파일"
& $iscc "/DVsixPath=$vsix" "/DAppVersion=$version" (Join-Path $here "BuildStudioExtension.iss")
if (-not $?) { throw "ISCC 실패" }

Write-Host ""
Get-ChildItem $release -Filter "*.exe" | Where-Object { $_.Name -like "*Extension*" } |
  Select-Object Name, @{n='MB';e={[math]::Round($_.Length/1MB,2)}}, LastWriteTime
