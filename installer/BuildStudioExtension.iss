; BUILD STUDIO 확장 설치 프로그램
;
; 하는 일은 하나입니다 — 이미 깔려 있는 VS Code 에 VSIX 를 설치합니다.
; 앱을 통째로 담지 않으므로 1MB 안팎으로 끝납니다.
;
; 빌드: installer\build.ps1  (또는 ISCC.exe 로 이 파일을 직접 컴파일)

#define AppName        "BUILD STUDIO 확장"
#define AppVersion     "0.1.0"
#define ExtensionId    "buildstudio.buildstudio-start"
#define VsixName       "buildstudio-0.1.0.vsix"
#ifndef VsixPath
  #define VsixPath     "..\..\BUILD-STUDIO-release\" + VsixName
#endif

[Setup]
AppId={{B7C4F1A2-5E3D-4A9B-8C61-2F0D9A7E5C34}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=BUILD STUDIO
VersionInfoVersion={#AppVersion}
VersionInfoDescription={#AppName} 설치 프로그램

; VS Code 확장은 사용자 폴더(%USERPROFILE%\.vscode\extensions)에 깔립니다.
; 관리자 권한이 필요 없으므로 요구하지 않습니다.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\BUILD STUDIO Extension
DisableDirPage=yes
DisableProgramGroupPage=yes
DisableWelcomePage=no
LicenseFile=..\LICENSE

SetupIconFile=setup-icon.ico
UninstallDisplayIcon={app}\setup-icon.ico
UninstallDisplayName={#AppName}
WizardStyle=modern
Compression=lzma2/max
SolidCompression=yes
OutputDir=..\..\BUILD-STUDIO-release
OutputBaseFilename=BUILD-STUDIO-Extension-Setup-{#AppVersion}

[Languages]
Name: "ko"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "en"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
ko.NoVSCode=VS Code 를 찾지 못했습니다.%n%n이 프로그램은 이미 설치된 VS Code 에 BUILD STUDIO 확장을 넣어주는 역할만 합니다. 먼저 https://code.visualstudio.com 에서 VS Code 를 설치한 뒤 다시 실행해주세요.
en.NoVSCode=VS Code was not found.%n%nThis installer only adds the BUILD STUDIO extension to an existing VS Code. Please install VS Code from https://code.visualstudio.com first, then run this again.
ko.Installing=VS Code 에 확장을 설치하는 중입니다...
en.Installing=Installing the extension into VS Code...
ko.InstallFailed=확장 설치에 실패했습니다 (코드 %1).%n%n다음 파일을 VS Code 에서 직접 설치해보세요:%n%2%n%n확장 패널(Ctrl+Shift+X) → ... → Install from VSIX...
en.InstallFailed=Failed to install the extension (code %1).%n%nYou can install this file manually from VS Code:%n%2%n%nExtensions panel (Ctrl+Shift+X) → ... → Install from VSIX...
ko.Finished=설치가 끝났습니다.%n%nVS Code 가 이미 켜져 있다면 Ctrl+Shift+P → Developer: Reload Window 를 한 번 실행해주세요. 왼쪽 활동 표시줄에 BUILD STUDIO 아이콘이 나타납니다.
en.Finished=Installation complete.%n%nIf VS Code is already running, press Ctrl+Shift+P and run "Developer: Reload Window". The BUILD STUDIO icon will appear in the activity bar.

[Files]
Source: "{#VsixPath}"; DestDir: "{app}"; DestName: "{#VsixName}"; Flags: ignoreversion
Source: "setup-icon.ico"; DestDir: "{app}"; Flags: ignoreversion

[Code]

// ── VS Code 찾기 ────────────────────────────────────────────────────────────
// code.cmd 를 찾습니다. 레지스트리(사용자 설치본 / 시스템 설치본)를 먼저 보고,
// 없으면 기본 설치 경로를 훑습니다. 마지막으로 Insiders 도 봅니다.

function TryCmd(Path: String; var Found: String): Boolean;
begin
  Result := (Path <> '') and FileExists(Path);
  if Result then
    Found := Path;
end;

function TryRegistry(Root: Integer; Key: String; Exe: String; var Found: String): Boolean;
var
  Location: String;
begin
  Result := False;
  if RegQueryStringValue(Root, Key, 'InstallLocation', Location) and (Location <> '') then
    Result := TryCmd(AddBackslash(Location) + 'bin\' + Exe, Found);
end;

function FindCodeCmd(): String;
begin
  Result := '';

  // 사용자 설치본 (User Setup)
  if TryRegistry(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{771FD6B0-FA20-440A-A002-3B3BAC16DC50}_is1', 'code.cmd', Result) then exit;
  // 시스템 설치본 (System Setup, 64비트 / 32비트)
  if IsWin64 and TryRegistry(HKLM64, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{EA457B21-F73E-494C-ACAB-524FDE069978}_is1', 'code.cmd', Result) then exit;
  if TryRegistry(HKLM32, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\{F8A2A208-72B3-4D61-95FC-8A65D340689B}_is1', 'code.cmd', Result) then exit;

  // 기본 경로
  if TryCmd(ExpandConstant('{localappdata}\Programs\Microsoft VS Code\bin\code.cmd'), Result) then exit;
  if TryCmd(AddBackslash(GetEnv('ProgramFiles')) + 'Microsoft VS Code\bin\code.cmd', Result) then exit;
  if TryCmd(AddBackslash(GetEnv('ProgramFiles(x86)')) + 'Microsoft VS Code\bin\code.cmd', Result) then exit;

  // Insiders
  if TryRegistry(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{217B4C08-948D-4276-BFBB-BEE930AE5A2C}_is1', 'code-insiders.cmd', Result) then exit;
  if TryCmd(ExpandConstant('{localappdata}\Programs\Microsoft VS Code Insiders\bin\code-insiders.cmd'), Result) then exit;
end;

// ── 설치 전: VS Code 가 없으면 시작하지 않습니다 ────────────────────────────

function InitializeSetup(): Boolean;
begin
  Result := FindCodeCmd() <> '';
  if not Result then
    MsgBox(ExpandConstant('{cm:NoVSCode}'), mbCriticalError, MB_OK);
end;

// ── 설치: code.cmd --install-extension ──────────────────────────────────────

procedure CurStepChanged(CurStep: TSetupStep);
var
  CodeCmd, Vsix, Params: String;
  ResultCode: Integer;
begin
  if CurStep <> ssPostInstall then
    exit;

  CodeCmd := FindCodeCmd();
  Vsix := ExpandConstant('{app}\{#VsixName}');

  WizardForm.StatusLabel.Caption := ExpandConstant('{cm:Installing}');

  // cmd /C 로 감쌉니다 — code.cmd 는 배치 파일이라 직접 실행되지 않습니다.
  // 경로에 공백이 있으므로 전체를 큰따옴표로 한 번 더 묶습니다.
  Params := '/C ""' + CodeCmd + '" --install-extension "' + Vsix + '" --force"';

  if (not Exec(ExpandConstant('{cmd}'), Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode)) or (ResultCode <> 0) then
    MsgBox(FmtMessage(ExpandConstant('{cm:InstallFailed}'), [IntToStr(ResultCode), Vsix]), mbError, MB_OK);
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then
    WizardForm.FinishedLabel.Caption := ExpandConstant('{cm:Finished}');
end;

// ── 제거: 확장도 같이 걷어냅니다 ────────────────────────────────────────────

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  CodeCmd: String;
  ResultCode: Integer;
begin
  if CurUninstallStep <> usUninstall then
    exit;

  CodeCmd := FindCodeCmd();
  if CodeCmd <> '' then
    Exec(ExpandConstant('{cmd}'), '/C ""' + CodeCmd + '" --uninstall-extension {#ExtensionId}"', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;
