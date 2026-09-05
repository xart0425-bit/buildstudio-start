<div align="center">

<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/banner.png" alt="BUILD STUDIO" width="900">

<br>

![VS Code](https://img.shields.io/badge/VS%20Code-%5E1.90-2A3038?style=flat-square&labelColor=0B0D10)
![License](https://img.shields.io/badge/License-MIT-2A3038?style=flat-square&labelColor=0B0D10)
![Claude Code](https://img.shields.io/badge/Claude%20Code-%EA%B8%B0%EB%B3%B8-2A3038?style=flat-square&labelColor=0B0D10)
![Codex](https://img.shields.io/badge/Codex-%EB%AA%A9%EC%97%85%C2%B7%EC%84%A4%EA%B3%84-2A3038?style=flat-square&labelColor=0B0D10)
![Gemini](https://img.shields.io/badge/Gemini-%EB%AA%A9%EC%97%85%C2%B7%EC%84%A4%EA%B3%84-2A3038?style=flat-square&labelColor=0B0D10)

**[설치](#설치)** &nbsp;·&nbsp; **[화면](#화면-한-바퀴)** &nbsp;·&nbsp; **[메뉴별 설명](#메뉴별-설명)** &nbsp;·&nbsp; **[개발 현황 단계](#개발-현황-단계-페이지)** &nbsp;·&nbsp; **[예제](#처음부터-끝까지--time-timer-만들기)** &nbsp;·&nbsp; **[설정](#설정)**

</div>

<br>

> ### In English
>
> **BUILD STUDIO** turns one sentence about what you want to build into a researched
> development plan, screen mockups, working code, and a shippable installer — without
> leaving VS Code.
>
> The actual work is done by the AI agent CLIs already installed and signed in on your
> machine: **Claude Code**, **Codex**, or **Gemini CLI**. BUILD STUDIO decides what to ask
> them and in what order, and shows you the progress. **It never asks for or stores an API
> key** — billing and model choice stay on your own subscription.
>
> ⚠️ **The interface and all documentation are in Korean.** An English UI is not available yet.

만들고 싶은 것을 한 줄로 설명하면 **조사해서 개발 계획서를 만들고**, 화면을 그려보고, 계획을 따라 실제로 만들고, 실행해 보고, GitHub 에 올리고, 설치파일까지 뽑습니다. 그 사이를 오가느라 창을 옮겨 다닐 일이 없습니다.

VS Code 확장이며, 실제 작업은 이미 여러분의 컴퓨터에 깔려 있고 로그인돼 있는 **AI 에이전트 CLI**(Claude Code · Codex · Gemini CLI)가 합니다. BUILD STUDIO 는 무엇을 어떤 순서로 시킬지 정하고, 그 진행을 화면에 보여줍니다. **API 키를 받아 보관하지 않습니다** — 요금과 모델 선택은 여러분의 구독을 그대로 따릅니다.

<div align="center">
<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/flow.png" alt="새 프로젝트 → 계획 → 목업 → 만들기 ⇄ 실행 → GitHub → 배포" width="900">
</div>

---

## 설치

### 1. 확장 설치

VS Code 의 `확장`(<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>X</kbd>) 에서 **BUILD STUDIO** 를 검색해 설치합니다.

명령줄에서 넣으려면:

```bash
code --install-extension buildstudio.buildstudio
```

<details>
<summary>소스에서 직접 빌드해 넣기</summary>

<br>

```bash
git clone https://github.com/xart0425-bit/buildstudio-start.git
```

이 폴더를 열고 `F5` 로 확장 개발 호스트를 띄웁니다. VSIX 와 Windows 설치파일을 직접 만들려면:

```powershell
powershell -ExecutionPolicy Bypass -File installer\build.ps1
```

</details>

### 2. 필요한 것

| | 무엇에 쓰나 | 준비 |
|:--|:--|:--|
| **[Claude Code](https://claude.com/claude-code)** | 계획 · 역설계 · 만들기 · 배포 (기본 엔진) | 확장 `anthropic.claude-code`, 또는 `npm i -g @anthropic-ai/claude-code` |
| **[Codex](https://github.com/openai/codex)** | 화면 목업 이미지 · 설계 대체 엔진 | `npm i -g @openai/codex` 후 `codex login` (ChatGPT 계정, API 키 불필요) |
| **[Gemini CLI](https://github.com/google-gemini/gemini-cli)** | 설계 대체 엔진 · 목업 이미지 | `npm i -g @google/gemini-cli`, 이미지는 [API 키](https://aistudio.google.com/apikey) 필요 |
| **[GitHub CLI](https://cli.github.com)** | 로그인 · 저장소 · 푸시 | `gh auth login` |

하나만 있어도 시작할 수 있습니다. 자격증명 저장소가 `~/.claude` · `~/.codex` · `~/.gemini` 로 갈라져 있어 전부 로그인해 둬도 서로 간섭하지 않습니다.

**스킬은 자동으로 깔립니다.** 확장이 켜질 때 `skills/buildplanner/` 를 `~/.claude/skills/buildplanner/` 로 복사합니다 (이미 있으면 건드리지 않습니다).

---

## 화면 한 바퀴

들어가는 문은 셋입니다 — 활동 표시줄의 <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-teardown.png" height="16"> 아이콘, 상태 표시줄의 `BUILD STUDIO`, 명령 팔레트의 `BUILD STUDIO:`. 시작 화면을 열면 자동으로 **3분할 배치**가 잡힙니다.

<div align="center">
<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/screen.png" alt="BUILD STUDIO 시작 화면 — 왼쪽 파일 트리, 가운데 카드, 오른쪽 Claude" width="960">
</div>

**화면은 지금 할 수 있는 것만 보여줍니다.**

- 폴더가 없으면 카드는 `새 프로젝트` 하나뿐입니다. 계획서를 저장할 곳이 없으니까요.
- `docs/BUILD-PLAN.md` 도 `docs/TEARDOWN.md` 도 없으면 `화면 목업` 카드는 나오지 않습니다. 눌러봐야 "문서부터 만드세요"를 듣고 돌아 나올 뿐이니까요.
- 카드가 하나뿐이면 한 번 더 누르게 하지 않고 바로 펼칩니다.

---

## 메뉴별 설명

<table>
<tr>
<td width="56" align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-new.png" width="34"></td>
<td width="150"><a href="#menu-new"><b>새 프로젝트</b></a></td>
<td>폴더를 만들고 그 안에서 시작합니다</td>
<td width="190"><code>&lt;폴더&gt;/</code></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-plan.png" width="34"></td>
<td><a href="#menu-plan"><b>아이디어를 계획</b></a></td>
<td>조사해서 기술 스택과 개발 단계를 정합니다</td>
<td><code>docs/BUILD-PLAN.md</code></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-teardown.png" width="34"></td>
<td><a href="#menu-teardown"><b>역설계</b></a></td>
<td>기존 제품의 원리를 뽑아 더 나은 설계를 냅니다</td>
<td><code>docs/TEARDOWN.md</code></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-mockup.png" width="34"></td>
<td><a href="#menu-mockup"><b>화면 목업</b></a></td>
<td>문서를 읽어 실제 화면 이미지를 만듭니다</td>
<td><code>docs/mockups/</code></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-build.png" width="34"></td>
<td><a href="#menu-build"><b>만들기</b></a></td>
<td>계획서의 다음 단계 하나를 실제로 만듭니다</td>
<td><code>docs/BUILD-LOG.md</code></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-docs.png" width="34"></td>
<td><a href="#menu-docs"><b>문서 다시 보기</b></a></td>
<td>만든 문서를 미리보기로 엽니다</td>
<td>—</td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-run.png" width="34"></td>
<td><a href="#menu-run"><b>Dev 모드로 실행</b></a></td>
<td>개발 서버를 띄우고 원하는 크기로 엽니다</td>
<td>—</td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-release.png" width="34"></td>
<td><a href="#menu-release"><b>배포하기</b></a></td>
<td>설치파일 · 무설치판 · 웹앱 · iOS · Android</td>
<td><code>setup.exe</code> 외</td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-github.png" width="34"></td>
<td><a href="#menu-github"><b>GitHub</b></a></td>
<td>로그인 · 저장소 · 버전 · 커밋 · 소개 문서</td>
<td><code>README.md</code></td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-engine.png" width="34"></td>
<td><a href="#menu-engine"><b>AI 모델 고르기</b></a></td>
<td>설계와 이미지를 각각 어떤 AI 로 돌릴지</td>
<td>—</td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-projects.png" width="34"></td>
<td><a href="#menu-projects"><b>프로젝트 목록</b></a></td>
<td>최근 프로젝트를 열고 · 새 창으로 띄우고 · 지웁니다</td>
<td>—</td>
</tr>
<tr>
<td align="center"><img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-layout.png" width="34"></td>
<td><a href="#menu-projects"><b>3분할 배치</b></a></td>
<td>파일 트리 · BUILD STUDIO · Claude 로 다시 세웁니다</td>
<td>—</td>
</tr>
</table>

<br>

<a name="menu-new"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-new.png" height="24"> 새 프로젝트

`BUILD STUDIO: 새 프로젝트`

폴더를 만들고 그 안에서 시작합니다. 계획서 · 목업 · 로그 · 코드가 전부 이 폴더에 모입니다. 새 창으로 열리면 **계획 카드가 펼쳐진 채로** 이어집니다 — 폴더를 만든 다음 무엇을 해야 하는지 다시 찾을 필요가 없습니다.

<a name="menu-plan"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-plan.png" height="24"> 아이디어를 계획

`BUILD STUDIO: 아이디어를 계획` &nbsp;→&nbsp; `docs/BUILD-PLAN.md`

만들고 싶은 것을 한 줄로 적으면, 시작 전에 **세 가지를 미리 묻습니다.**

| 질문 | 선택지 |
|:--|:--|
| 무엇으로 만드나요? | 웹앱 · 데스크톱 앱 · 모바일 앱 · 명령줄 도구 · 아직 모름 |
| 누가 쓰나요? | 나만 · 팀 내부 · 일반에 배포 |
| 어디서 시작하나요? | 새로 시작 · 이 폴더의 기존 코드에 얹기 |

> 작업 도중에 AI 가 되묻는 말은 터미널에 뜨는데, 그때 사용자는 보통 다른 화면을 보고 있습니다. 한 번 물으면 작업이 그대로 멈춥니다. 그래서 갈림길이 될 질문은 **앞으로 당겨** 버튼으로 받습니다. `건너뛰고 시작` 을 누르면 묻지 않습니다.

그다음 GitHub · 모델 · 논문 · 커뮤니티를 실제로 조사해서 기술 스택 · 난이도 · 리스크 · 개발 단계가 담긴 계획서를 씁니다. **조사 없이 일반론으로 채우지 않고**, 못 찾은 것은 "해당 없음"으로 남깁니다.

<a name="menu-teardown"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-teardown.png" height="24"> 역설계

`BUILD STUDIO: 역설계` &nbsp;→&nbsp; `docs/TEARDOWN.md`

기존 제품 이름(공식 URL 을 붙이면 정확해집니다)을 넣으면 여섯 단계로 분석합니다.

**대상 파악** → **작동 원리 추출** → **균열 찾기**(원본이 감수한 타협) → **도약 설계**(새 제품) → **차별화 감사**(자기 검증) → **문서 작성**

베끼기가 아닙니다. 원본이 무엇을 포기했는지 찾아내고, 그 자리에서 **더 나은 설계**를 뽑아내는 것이 목적입니다. 시작 전에 `무엇을 위한 분석인가요?`(더 나은 걸 만들려고 · 구조가 궁금해서 · 경쟁 제품 파악)와 `어디까지 보나요?`(제품 전체 · 특정 기능만)를 묻습니다.

<a name="menu-mockup"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-mockup.png" height="24"> 화면 목업

`BUILD STUDIO: 화면 목업 만들기` &nbsp;→&nbsp; `docs/mockups/`

계획서나 역설계 보고서를 읽어 **실제 화면 이미지**를 만듭니다. 순서가 중요합니다.

<div align="center">
<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/mockup-flow.png" alt="프롬프트 확인 → 이미지 생성 → 보여주기 → 반영" width="900">
</div>

**반영을 누르기 전까지 문서는 손대지 않습니다.** 먼저 고쳐 두고 나중에 무르는 방식은, 마음에 안 드는 그림이 잠깐이라도 계획서에 남습니다.

문서가 둘 다 있으면 어느 쪽을 바탕으로 할지 묻습니다. 역설계 보고서를 고르면 분석 대상이 아니라 **보고서가 제안한 더 나은 제품**의 화면을 그립니다.

그리고 이 그림은 장식이 아닙니다 — 다음 `만들기` 가 이 화면을 보고 구현합니다.

<a name="menu-build"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-build.png" height="24"> 만들기

계획이 끝난 자리에서만 나타납니다. 시작 화면의 카드로는 내놓지 않습니다 — 계획서가 있어야 의미가 있는 버튼이기 때문입니다.

`docs/BUILD-PLAN.md` 를 읽고 **다음 단계 하나**를 실제로 만듭니다. 한 번에 전부 만들지 않습니다.

- 만들기 전에 무엇을 만들지 한 문단으로 먼저 말합니다 — "그건 아닌데"라고 말할 틈을 줍니다.
- 이미 있는 코드를 갈아엎어야 하면 반드시 먼저 묻습니다.
- 껍데기만 만들고 "완성"이라 하지 않습니다. 의존성을 넣으면 실제로 설치하고 실행해서 확인합니다.
- 끝나면 `docs/BUILD-LOG.md` 에 **만든 것 · 확인한 것 · 남은 것**을 덧붙입니다. 다음 `만들기` 가 그 로그를 읽고 이어서 갑니다.

<a name="menu-docs"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-docs.png" height="24"> 문서 다시 보기

`BUILD STUDIO: 문서 다시 보기`

`docs/` 안의 `.md` 를 최근 수정순으로 보여줍니다. 파일을 직접 클릭하면 편집기가 열려 원본 마크다운이 나오므로, 여기서는 **항상 미리보기로** 엽니다. 전용 스타일시트(`media/preview.css`)가 적용됩니다.

<a name="menu-run"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-run.png" height="24"> Dev 모드로 실행

`BUILD STUDIO: Dev 모드로 실행`

`package.json` 의 `scripts` 에서 `dev` → `start` → `serve` 순으로 찾아 터미널에서 띄우고, **실제로 열린 포트를 찾아** 원하는 곳에 엽니다.

| 어디에 | 무엇 |
|:--|:--|
| 새 창 | 앱 안의 별도 탭 (Simple Browser) |
| 웹 브라우저 | 기본 브라우저로 |
| 모바일 | 390 × 844 크기의 창 |
| 태블릿 | 820 × 1180 크기의 창 |

> 포트를 미리 정해두지 않습니다. 프로젝트마다 다르고(Vite 5173, Next 3000 …) 설정으로 바뀌기도 해서, 추측한 주소를 열면 빈 화면만 나옵니다. `5173 · 3000 · 8080 · 4200 · 5000 · 8000 · 1420` 을 40초 동안 훑되, **띄우기 직전에 이미 열려 있던 포트는 제외합니다.** 다른 프로젝트의 서버를 우리 것으로 착각해 엉뚱한 앱을 띄우지 않기 위해서입니다.

<a name="menu-release"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-release.png" height="24"> 배포하기

`BUILD STUDIO: 배포하기`

| 형태 | 결과물 |
|:--|:--|
| Windows 설치파일 | Inno Setup · `setup.exe` |
| 무설치판 | 압축 풀면 바로 실행 |
| 웹앱 | 정적 빌드 · 호스팅 |
| iOS | App Store 또는 TestFlight |
| Android | APK · Play 스토어 |

`프로젝트 확인` 을 누르면 **지난번 배포의 흔적을 찾아 화면을 미리 채웁니다** — `package.json` 의 `productName` · `build.icon`, `installer/*.iss` 의 `#define AppName`, `assets/` · `public/` · `src-tauri/icons/` 의 아이콘 파일. 어디서 가져온 값인지 화면에 함께 적습니다. 안 그러면 고쳐야 할 값인지 알 수 없으니까요.

`설치 화면 분위기` 칸에 "어두운 배경에 얇은 로고, 파란 강조색" 처럼 적으면 그대로 만들어 줍니다.

<a name="menu-github"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-github.png" height="24"> GitHub

시작 화면 아래 `GitHub` 버튼. 한 화면에서 상태를 보고, 그 자리에서 처리합니다.

| | |
|:--|:--|
| **계정** | `gh auth status` 로 읽습니다. 없으면 `gh auth login` |
| **저장소** | 없으면 만들고(비공개/공개를 묻습니다) 원격을 붙입니다. 있으면 브라우저로 엽니다 |
| **변경** | 커밋되지 않은 파일 수 |
| **버전 올리기** | `package.json` 의 버전을 읽어 패치 · 마이너 · 메이저 후보를 계산해 버튼으로 내놓습니다 |
| **커밋하고 올리기** | 커밋 신원(`user.name` · `user.email`)이 없으면 먼저 챙깁니다. 없으면 커밋 자체가 실패합니다 |
| **기능 소개 생성** | 코드를 읽어 `README.md` 를 씁니다. 있으면 갱신합니다 |

> 로그인 · 저장소 생성 · 푸시는 되돌리기 어렵거나 대화가 필요해서 **터미널에서 돌립니다.** 결과와 오류를 그대로 보셔야 합니다 — 조용히 실패하면 남의 계정에 무슨 일이 일어났는지 알 길이 없습니다.

<a name="menu-engine"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-engine.png" height="24"> AI 모델 고르기

`BUILD STUDIO: AI 모델 고르기` — 화면 아래 `설계 Claude · 이미지 Codex` 를 눌러도 됩니다.

**설계**(계획 · 역설계 · 만들기 · 배포)와 **이미지**(목업)를 각각 따로 고릅니다. 글을 잘 쓰는 모델과 그림을 만들 수 있는 모델이 같지 않아서입니다.

| | 고를 수 있는 것 | `자동` 일 때 순서 |
|:--|:--|:--|
| **설계** | Claude Code · Codex(ChatGPT) · Gemini CLI | Claude → Codex → Gemini |
| **이미지** | Codex(ChatGPT) · Gemini 이미지(API 키) | Codex → Gemini |

목록에는 **깔려 있는지 · 로그인돼 있는지**가 함께 뜹니다. 준비 안 된 것을 고르면 무엇이 빠졌는지 알려줍니다. Claude 는 BUILD STUDIO 의 지시서를 슬래시 명령(`/buildplanner:plan`)으로 알아듣고, Codex · Gemini 는 같은 지시서 **파일을 읽혀서** 같은 절차를 밟게 합니다.

<a name="menu-projects"></a>

### <img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-projects.png" height="24"> 프로젝트 목록 · 3분할 배치

시작 화면 아래쪽에 최근 프로젝트가 쌓입니다. 누르면 그 폴더로 이동하고, `새 창` 은 따로 띄우고, `삭제` 는 **폴더 이름을 그대로 입력해야** 버튼이 켜집니다.

`BUILD STUDIO: 3분할 배치로 정리` 는 흐트러진 창을 파일 트리 · BUILD STUDIO · Claude 로 다시 세웁니다.

---

## 개발 현황 단계 페이지

무엇을 시작하든 화면은 **진행 화면**으로 바뀝니다. 터미널을 들여다보지 않아도 지금 어디쯤인지 보이게 하는 것이 이 화면의 목적입니다.

<div align="center">
<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/progress.png" alt="진행 화면 — 단계 목록, 지금 단계의 뛰는 점, 경과 시간" width="860">
</div>

| 표시 | 뜻 |
|:--:|:--|
| ● | 지금 하고 있는 단계 — 맥박처럼 뜁니다 |
| ◐ | 끝난 단계 |
| ○ | 아직 오지 않은 단계 |

맨 위의 가느다란 선은 계속 흐릅니다. 그 움직임은 `status.json` 과 무관합니다 — 신호가 안 와도 화면은 계속 숨을 쉬어야 멈춘 것으로 보이지 않기 때문입니다. 경과 시간은 1초마다 갱신됩니다.

### 어떻게 이걸 아나

AI 는 단계에 **들어갈 때마다** 워크스페이스의 `.buildstudio/status.json` 을 덮어씁니다.

```json
{ "kind": "plan", "step": 2, "label": "조사 중 — GitHub, 모델, 논문, 커뮤니티", "done": false }
```

확장은 이 파일을 감시하다 화면에 반영하고, 다 끝나면 이렇게 받습니다.

```json
{ "kind": "plan", "step": 4, "label": "완료", "done": true, "file": "docs/BUILD-PLAN.md" }
```

> 단계 표시는 **없어도 되는 정보로만** 씁니다. AI 가 이 파일을 안 쓰더라도 화면은 계속 동작해야 하고, 실제 결과는 문서와 코드로 남기 때문입니다.

### 멈춘 것 같을 때

2분 동안 아무 신호도 오지 않으면 진행 화면 위에 경고가 뜹니다. 상태 표시줄에도 색이 들어간 항목이 하나 생깁니다.

<div align="center">
<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/stall.png" alt="확인이 필요할 수 있습니다 — 2분 동안 신호 없음" width="860">
</div>

대개는 AI 가 무언가 물어놓고 답을 기다리는 중입니다.

### 끝나면

문서가 자동으로 **미리보기로** 열리고, 진행 화면은 다음 할 일로 바뀝니다.

<div align="center">
<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/done.png" alt="완료 — 만들기 · 목업 만들기 · 문서 보기" width="860">
</div>

`만들기` 를 누르면 같은 자리에서 곧바로 다음 진행 화면이 시작됩니다.

### 단계 목록

| 작업 | 1 | 2 | 3 | 4 | 5 | 6 |
|:--|:--|:--|:--|:--|:--|:--|
| **아이디어를 계획** | 아이디어 파악 | 조사 | 판단 | 계획서 작성 | | |
| **역설계** | 대상 파악 | 작동 원리 추출 | 균열 찾기 | 도약 설계 | 차별화 감사 | 문서 작성 |
| **만들기** | 계획서 읽기 | 무엇을 만들지 정하기 | 만들기 | 돌려보고 기록 | | |

---

## 처음부터 끝까지 — Time Timer 만들기

남은 시간이 **빨간 원판이 줄어드는 것**으로 보이는 타이머를 만든다고 해봅시다. 아이가 쓸 것이라 숫자보다 그림이 먼저입니다.

<div align="center">
<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/timer.png" alt="Time Timer — 모바일 390 × 844 로 실행한 1단계 결과" width="860">
</div>

### 1 &nbsp;·&nbsp; 폴더를 만든다

`새 프로젝트` → 이름 `time-timer` → 새 창이 열리고 계획 카드가 펼쳐진 채로 시작됩니다.

### 2 &nbsp;·&nbsp; 아이디어를 계획한다

입력칸에 이렇게 적습니다.

> 남은 시간이 빨간 원판으로 줄어드는 타이머. 아이가 쓸 것

세 가지를 묻습니다 — **웹앱** · **일반에 배포** · **새로 시작**. `시작` 을 누르면 진행 화면으로 넘어가고, 3~5분 뒤 `docs/BUILD-PLAN.md` 가 미리보기로 열립니다.

| 계획서에 들어 있는 것 | |
|:--|:--|
| **기술 스택** | Vite + React, 화면은 SVG 원호(`stroke-dasharray`), 카운트다운은 `requestAnimationFrame` — 각 선택마다 왜 그것인지, 대안은 무엇이었는지 |
| **조사 결과** | 실제로 존재하는 저장소와 라이브러리 링크. 브라우저 탭이 백그라운드로 가면 타이머가 느려지는 알려진 함정과 그 해법 |
| **개발 단계** | 1 원판이 도는 화면 · 2 시간 설정과 일시정지 · 3 소리와 알림 · 4 설정 저장 |
| **리스크** | 모바일 브라우저의 자동재생 제한으로 알림음이 안 날 수 있음 |

### 3 &nbsp;·&nbsp; 화면을 먼저 본다

계획서가 생겼으니 이제 `화면 목업` 카드가 나타납니다. 프롬프트가 편집기에 뜨고("한가운데 커다란 빨간 원판, 아래에 시작/정지…"), 고칠 게 없으면 그대로 진행합니다. 1~3분 뒤 이미지가 열립니다. 마음에 들면 `반영`, 아니면 `버리고 다시 만들기`.

### 4 &nbsp;·&nbsp; 만든다

`만들기` 를 누르면 Claude 창에 먼저 이렇게 뜹니다.

> 1단계를 만듭니다. `src/Dial.jsx` 에 SVG 원호를, `src/useTimer.js` 에 `requestAnimationFrame` 기반 카운트다운을 두겠습니다. 계획서의 "원판이 도는 화면"까지입니다. 소리와 설정은 다음 단계입니다.

전부 만들지 않습니다. **1단계 하나**입니다. 끝나면 `docs/BUILD-LOG.md` 에 만든 것 · 확인한 것 · 남은 것이 남습니다.

### 5 &nbsp;·&nbsp; 돌려본다

`Dev 모드로 실행` → `모바일 (390 × 844)`. 터미널에서 `npm run dev` 가 돌고, 확장이 실제로 열린 포트(여기서는 5173)를 찾아 위 그림 같은 창으로 엽니다. 아이 손에 쥐여줄 화면 그대로입니다 — 원판이 도는지, 60초가 정말 60초인지 눈으로 봅니다.

### 6 &nbsp;·&nbsp; 올린다

`GitHub` → `로그인` → `저장소 만들기`(공개) → 커밋 메시지 `1단계 — 원판이 도는 화면` → `커밋하고 올리기`. `기능 소개 생성` 을 누르면 코드를 읽어 `README.md` 를 써줍니다.

### 7 &nbsp;·&nbsp; 이어서 만든다

`만들기` 를 다시 누릅니다. 이번엔 `docs/BUILD-LOG.md` 를 읽고 **2단계**(시간 설정과 일시정지)부터 시작합니다. 3단계, 4단계도 같은 방식입니다.

### 8 &nbsp;·&nbsp; 내보낸다

`배포하기` → `웹앱` → `프로젝트 확인`(이름 `Time Timer`, 버전 `0.4.0` 이 자동으로 채워집니다) → `배포 준비 시작`. 데스크톱 앱으로도 주고 싶다면 `Windows 설치파일` 을 고르고 아이콘 파일과 "밝은 배경에 빨간 원, 흰 글씨" 같은 분위기를 적어주면 됩니다.

---

## 설정

`파일 ▸ 기본 설정 ▸ 설정` 에서 `buildstudio` 로 검색합니다.

| 설정 | 기본값 | 뜻 |
|:--|:--|:--|
| `buildstudio.showOnStartup` | `true` | 열 때 시작 화면을 자동으로 띄웁니다 |
| `buildstudio.runIn` | `panel` | `panel` — 오른쪽 Claude 창에서 진행<br>`terminal` — 터미널에서 진행 |
| `buildstudio.planEngine` | `auto` | 설계를 어떤 AI 로: `auto` · `claude` · `codex` · `gemini` |
| `buildstudio.planModel` | (빈값) | 설계에 쓸 모델 이름. 예: `opus`, `gpt-5.1-codex`, `gemini-2.5-pro` |
| `buildstudio.imageEngine` | `auto` | 목업 이미지를 어떤 AI 로: `auto` · `codex` · `gemini` |
| `buildstudio.geminiApiKey` | (빈값) | Gemini 이미지용 API 키. 비우면 `GEMINI_API_KEY` 환경변수 |
| `buildstudio.geminiImageModel` | (빈값) | 비우면 `gemini-2.5-flash-image` |
| `buildstudio.codexExecutable` | (빈값) | Codex 실행 파일 경로. 비우면 알아서 찾습니다 |
| `buildstudio.codexModel` | (빈값) | 목업에 쓸 Codex 모델. 비우면 Codex 기본값 |

---

## 어떻게 만들어졌나

```
extension.js      시작 화면 · 진행 감시 · 실행 · 배포 · GitHub · 프로젝트 관리
engines.js        어떤 AI 로 돌릴지 한 곳에서 판정 (설치 · 로그인 · 명령 조립)
mockup.js         문서를 읽어 목업 프롬프트를 만들고, 물어본 뒤 문서에 반영
codexImages.js    Codex 로 이미지 만들기
geminiImages.js   Gemini API 로 이미지 만들기

skills/buildplanner/skills/
  plan · teardown · build · release · readme     AI 에게 건네는 지시서

installer/
  build.ps1       VSIX 포장 + Inno Setup 컴파일
  sync-fork.ps1   포크 앱 내장본 동기화
```

몇 가지 결정과 그 이유:

- **AI 를 직접 부르지 않습니다.** 이미 깔려 있고 로그인돼 있는 CLI 에 일을 넘깁니다. API 키를 받아 보관할 일이 없고, 요금·모델은 사용자의 구독을 그대로 따릅니다.
- **문서화된 인터페이스만 씁니다.** Claude Code 확장의 내부 API 를 부르는 편이 화면상 매끄럽지만, 그건 번들 내부라 확장이 업데이트되면 조용히 깨집니다.
- **진행 상황은 파일로 주고받습니다.** `.buildstudio/status.json` 하나로 어느 엔진에서 돌든 같은 화면이 나옵니다.
- **작업은 단계로 쪼갭니다.** 한 번에 전부 만들면 사람이 확인할 수 없는 크기가 됩니다.
- **되돌리기 어려운 일은 터미널에서 보여주며 합니다.** GitHub 푸시, 저장소 생성, 폴더 삭제.

---

## 알아둘 것

- **Claude 창에서는 Enter 를 한 번 눌러야 시작됩니다.** Claude 확장이 프롬프트를 입력창에 적어주는 것까지만 허용하고, 밖에서 보낼 방법을 열어두지 않았습니다. 누르는 즉시 시작되길 원하시면 `buildstudio.runIn` 을 `terminal` 로 바꾸세요. 대신 되묻는 말이 터미널 글자로 뜹니다.
- **제한 모드(신뢰하지 않은 폴더)에서는 아무것도 시작되지 않습니다.** 터미널을 만드는 것 자체가 막히기 때문입니다. 시작 화면은 열리고, 폴더를 신뢰하면 하던 작업을 이어갑니다.
- **상단 메뉴 항목은 없습니다.** VS Code 는 확장이 최상위 메뉴를 만드는 것을 허용하지 않습니다. 활동 표시줄 · 상태 표시줄 · 명령 팔레트로 들어갑니다.
- **목업은 문서가 있어야 만들 수 있습니다.** `docs/BUILD-PLAN.md` 또는 `docs/TEARDOWN.md` 중 하나는 있어야 합니다.
- **`만들기` 는 한 단계씩만 합니다.** 계획서 전체를 한 번에 만들지 않습니다.
- **프로젝트 삭제는 되돌릴 수 없습니다.** 폴더를 통째로 지웁니다. 그래서 이름을 그대로 입력해야만 버튼이 켜집니다.
- iOS · Android 배포는 macOS 또는 해당 도구가 갖춰진 환경이 필요합니다.
- 서명 없는 설치파일은 Windows SmartScreen 경고를 띄웁니다. Smart App Control 이 켜진 PC 에서는 실행이 막힐 수 있습니다.

---

<div align="center">

<img src="https://raw.githubusercontent.com/xart0425-bit/buildstudio-start/main/media/readme/ic-layout.png" width="30">

**MIT License**

</div>
