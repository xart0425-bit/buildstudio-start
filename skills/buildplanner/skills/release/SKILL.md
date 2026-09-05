---
name: release
description: 프로젝트를 배포 가능한 형태로 만듭니다 — Windows 설치파일(exe), 무설치판, 웹앱, iOS, Android. 사용자가 "배포", "설치파일 만들어줘", "exe로 만들어줘", "앱스토어에 올리고 싶다", "빌드해줘"라고 할 때 사용합니다. Use when the user wants to package or ship the project.
argument-hint: [형태] [앱 이름] [버전] [아이콘]
allowed-tools: Read Glob Grep WebSearch WebFetch
---

# 배포 — 만든 것을 남에게 건넬 수 있는 형태로

BUILD STUDIO 배포 화면에서 넘어온 값이 `$ARGUMENTS`에 있다.
`형태: ..., 앱 이름: ..., 버전: ..., 아이콘: ..., 설치 화면: ...`

**이 값들은 이미 받은 답이다. 다시 묻지 않는다.**

## 진행 상황 보고 (필수)

각 단계에 들어갈 때마다 워크스페이스 루트의 `.buildstudio/status.json`을 덮어쓴다.

```json
{ "kind": "release", "step": 2, "label": "빌드 도구 확인", "done": false }
```

끝나면 `"done": true`와 `"file"`에 산출물 경로를 넣어 한 번 더 쓴다.

## 원칙

- **사용자는 프로그래머가 아닐 수 있다.** 설치가 필요하면 무엇을 왜 까는지 한 줄로 설명하고,
  용량과 걸리는 시간을 미리 알린다.
- **긴 작업은 백그라운드로 돌리고 진행 상황을 알린다.** 조용히 20분 멈춰 있으면 안 된다.
- **실패하면 원인을 먼저 찾는다.** 같은 명령을 조건만 바꿔 반복하지 않는다.
- 결과물 경로를 반드시 알려준다.

## 1단계 — 프로젝트 파악

무엇을 배포하는지부터 본다.

- `package.json` — 스택, 빌드 스크립트, 이미 있는 패키징 설정
- 프레임워크 — Electron / Tauri / Vite / Next / React Native / Flutter …
- 이미 빌드 산출물이 있는지 (`dist/`, `build/`, `out/`)

**스택에 따라 배포 방법이 완전히 달라진다.** 웹 프로젝트를 Windows 설치파일로 만들라는
요청이면 Electron 또는 Tauri로 감싸야 하고, 그건 큰 작업이다. 그럴 땐 무엇이 필요한지
먼저 알리고 동의를 구한다.

## 2단계 — 형태별 작업

### Windows 설치파일 (Inno Setup)

1. 앱을 빌드한다
2. **런타임을 함께 넣는다.** 받는 사람 PC에 Node 가 없어도 돌아가야 한다.
   nodejs.org 에서 win-x64 를 받고 **SHA256 을 공식 해시와 대조**한다
3. `node_modules` 를 실제로 쓰는 것만 남긴다 (300MB → 50MB 수준)
4. Inno Setup 스크립트(`.iss`)를 쓴다
   - **`AppId` GUID 는 새로 발급한다.** 다른 앱과 같으면 Windows 가 같은 프로그램으로
     보고 서로 덮어쓴다
   - 관리자 권한 없이 `%LOCALAPPDATA%\Programs\<앱>` 에 설치되게 한다
5. **저장소 바깥으로 복사해 실행을 검증한다.** 제자리에서 테스트하면 상위 폴더의
   `node_modules` 가 빠진 자리를 메워버려서, 설치본에서만 죽는 누락을 못 잡는다
6. `ISCC` 로 컴파일

Inno Setup 이 없으면: `winget install -e --id JRSoftware.InnoSetup`

### 무설치판

같은 스테이징까지 하고 압축만 한다. 실행 파일 하나로 바로 뜨게 하고,
설정은 실행 파일 옆이 아니라 `%LOCALAPPDATA%` 에 두어 USB 에서도 돌게 한다.

### 웹앱

정적 빌드를 만들고 배포처를 정한다. 사용자가 정하지 못하면 무료로 시작할 수 있는
곳(Vercel · Netlify · Cloudflare Pages · GitHub Pages)을 한 줄 설명과 함께 제시한다.
빌드 산출물 경로와 배포 명령을 알려주고, 자동 배포까지 원하면 설정을 만들어 준다.

### iOS · Android

**먼저 현실을 알린다.** 이건 도구만으로 끝나지 않는다.

| | iOS | Android |
|---|---|---|
| 개발 장비 | **macOS 필수** | Windows 가능 |
| 계정 | Apple Developer 연 $99 | Google Play 1회 $25 |
| 서명 | 인증서 · 프로비저닝 | 키스토어 |

Windows 에서 작업 중이면 iOS 빌드는 여기서 못 만든다. 그 사실을 먼저 말하고,
할 수 있는 것(코드 준비, Capacitor/React Native 설정, Android 빌드)까지만 진행한다.

웹앱이면 Capacitor 로 감싸는 것이 가장 짧은 길이다.

## 3단계 — 아이콘과 설치 화면

`아이콘:` 경로가 주어지면 형태별로 변환한다.

- Windows: `.ico` (16·32·48·256 다중 해상도)
- iOS/Android: 각 밀도별 PNG
- 웹: `favicon.ico` + `apple-touch-icon.png` + 매니페스트

주어지지 않으면 앱 이름 첫 글자로 단정한 기본 아이콘을 만든다.
`설치 화면:` 설명이 있으면 그 분위기로 배너를 만든다.

## 4단계 — 마무리

터미널에는 **짧게** 보고한다.

- 결과물 **전체 경로**와 크기
- 받는 사람이 해야 할 것 (예: SmartScreen 경고에서 [추가 정보] ▸ [실행])
- 다음에 다시 만들 때의 방법 한 줄
- 못 한 것이 있으면 이유와 함께 명시

**코드 서명이 없으면 반드시 알린다.** Windows SmartScreen 이 경고를 띄우는데,
이걸 모르고 배포하면 받는 사람이 바이러스로 오해한다.
