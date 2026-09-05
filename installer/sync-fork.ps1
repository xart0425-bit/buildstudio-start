# BUILD STUDIO 확장 -> 포크 앱 내장본 동기화
#
#   powershell -ExecutionPolicy Bypass -File installer\sync-fork.ps1
#
# 확장은 두 갈래로 나갑니다.
#   1) VSIX  -> 일반 VS Code (installer\build.ps1 이 만듭니다)
#   2) 내장본 -> 포크 앱 resources\app\extensions\buildstudio  <- 이 스크립트
#
# 2번은 설치 프로그램이 건드리지 않습니다. 이 스크립트를 돌리지 않으면
# 포크 앱에는 옛 확장이 그대로 남아, 새로 넣은 버튼이 보이지 않습니다.

$ErrorActionPreference = "Stop"

$here    = Split-Path -Parent $MyInvocation.MyCommand.Path
$project = Split-Path -Parent $here

$roots = @(
  "Z:\AI_Storage\Project_Folder\VSCode-win32-x64\resources\app\extensions",              # 빌드 산출물 (설치 exe 의 재료)
  "C:\Users\super\AppData\Local\Programs\BUILD STUDIO\resources\app\extensions"          # 설치된 앱
)

$targets = $roots | ForEach-Object { Join-Path $_ "buildstudio" }

# 옛 이름으로 깔린 내장본을 지웁니다. 2026-09-05 에 확장 id 를
# buildstudio.buildstudio-start -> buildstudio.buildstudio 로 바꿨습니다. 그대로 두면
# 같은 화면을 여는 확장이 둘이 되어, 활동 표시줄에 아이콘이 두 개 뜹니다.
foreach ($r in $roots) {
  $legacy = Join-Path $r "buildstudio-start"
  if (Test-Path $legacy) {
    Remove-Item $legacy -Recurse -Force
    Write-Host "옛 내장본 삭제: $legacy"
  }
}

# 내장본에 들어갈 것만. .vscodeignore 와 같은 기준입니다.
# extension.js 가 require 하는 것까지 전부 넣습니다. 하나라도 빠지면 포크 앱에서
# 확장이 통째로 켜지지 않습니다 — 2026-09-02 에 engines.js 와 geminiImages.js 가
# 빠져 있어서, 내장본이 engines 를 부르기 전 판까지 그대로 남아 있었습니다.
$files = @("extension.js", "mockup.js", "codexImages.js", "engines.js", "geminiImages.js")
$mediaFiles = @("icon.svg", "icon.png", "icon-gallery.png", "preview.css")

# 문법 검사 — 깨진 파일을 앱 안에 밀어 넣지 않도록
$node = "C:\Program Files\nodejs\node.exe"
if (Test-Path $node) {
  foreach ($f in $files) {
    $p = Join-Path $project $f
    if (Test-Path $p) { & $node --check $p; if (-not $?) { throw "$f 문법 오류" } }
  }
}

# 포크는 활동 표시줄 아이콘으로 테마를 따라가는 icon.svg 를 씁니다.
# VSIX 쪽(icon.png)과 다른 유일한 지점이라 여기서만 바꿔 넣습니다.
$pkg = Get-Content (Join-Path $project "package.json") -Raw -Encoding UTF8
$pkgFork = $pkg -replace '"icon": "media/icon\.png"', '"icon": "media/icon.svg"'
if ($pkgFork -eq $pkg) { throw "package.json 에서 활동 표시줄 아이콘 줄을 찾지 못했습니다" }

foreach ($t in $targets) {
  $parent = Split-Path -Parent $t
  if (-not (Test-Path $parent)) {
    Write-Host "건너뜀 (없는 경로): $t"
    continue
  }

  New-Item -ItemType Directory -Force (Join-Path $t "media") | Out-Null

  foreach ($f in $files) {
    $src = Join-Path $project $f
    if (Test-Path $src) { Copy-Item $src (Join-Path $t $f) -Force }
  }
  foreach ($f in $mediaFiles) {
    $src = Join-Path $project "media\$f"
    if (Test-Path $src) { Copy-Item $src (Join-Path $t "media\$f") -Force }
  }

  # 지시서(스킬)도 함께 넣습니다. 이게 없으면 Codex · Gemini 로 돌 때 슬래시 명령이
  # 그대로 나가서, 화면은 도는데 결과만 엉뚱해집니다.
  $skillsFrom = Join-Path $project "skills"
  if (Test-Path $skillsFrom) {
    $skillsTo = Join-Path $t "skills"
    if (Test-Path $skillsTo) { Remove-Item $skillsTo -Recurse -Force }
    Copy-Item $skillsFrom $skillsTo -Recurse -Force
  }

  # BOM 없는 UTF-8 로 써야 VS Code 가 읽습니다.
  [System.IO.File]::WriteAllText(
    (Join-Path $t "package.json"), $pkgFork, (New-Object System.Text.UTF8Encoding($false)))

  Write-Host "동기화: $t"
}

Write-Host ""
Write-Host "포크 앱을 완전히 껐다 켜야 반영됩니다 (창 새로 고침만으로는 부족합니다)."
