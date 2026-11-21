; Windows installer of the MAGIS server (for the centre's mini-PC).
; Built by GitHub: makensis /DVERSION=x.y.z installer.nsi (files staged next to this script).
Unicode true
!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define APP "MAGIS Server"
Name "${APP} ${VERSION}"
OutFile "MAGIS-Server_${VERSION}_setup.exe"
InstallDir "$PROGRAMFILES64\MAGIS Server"
RequestExecutionLevel admin
ShowInstDetails show

Page directory
Page instfiles
UninstPage uninstConfirm
UninstPage instfiles

Section "Install"
  ; an older version wrote its Settings > Apps entry in the 32-bit registry: clear it, then write it where Windows looks
  SetRegView 32
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server"
  SetRegView 64
  ; an update: stop the running server first (the data in ProgramData\MAGIS is never touched)
  nsExec::ExecToLog 'schtasks /End /TN "MAGIS Server"'
  nsExec::ExecToLog 'taskkill /F /IM magis-node.exe'
  Sleep 1500

  SetOutPath "$INSTDIR"
  File "stage\magis-node.exe"
  File "stage\server.mjs"
  File "run.cmd"
  File "install-task.ps1"
  RMDir /r "$INSTDIR\web"
  SetOutPath "$INSTDIR\web"
  File /r "stage\web\*.*"
  SetOutPath "$INSTDIR"
  CreateDirectory "$COMMONAPPDATA\MAGIS"
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; the network: allow the two ports of the server
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MAGIS Server"'
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="MAGIS Server" dir=in action=allow protocol=TCP localport=8443,8444,8080 profile=any'

  ; start at every boot, then now
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\install-task.ps1" -Dir "$INSTDIR"'

  ; shortcuts to open the program on this computer
  WriteINIStr "$DESKTOP\MAGIS Accounts.url" "InternetShortcut" "URL" "https://localhost:8443"
  CreateDirectory "$SMPROGRAMS\MAGIS"
  WriteINIStr "$SMPROGRAMS\MAGIS\MAGIS Accounts.url" "InternetShortcut" "URL" "https://localhost:8443"
  CreateShortCut "$SMPROGRAMS\MAGIS\Server log.lnk" "notepad.exe" "$COMMONAPPDATA\MAGIS\server.log"
  CreateShortCut "$SMPROGRAMS\MAGIS\Data and backups.lnk" "$COMMONAPPDATA\MAGIS"
  CreateShortCut "$SMPROGRAMS\MAGIS\Uninstall MAGIS Server.lnk" "$INSTDIR\uninstall.exe"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "DisplayName" "${APP}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "QuietUninstallString" '"$INSTDIR\uninstall.exe" /S'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "Publisher" "MAGIS"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server" "NoRepair" 1

  ; give the server a few seconds to make its certificate, then open it
  Sleep 6000
  ExecShell "open" "https://localhost:8443"
SectionEnd

Section "Uninstall"
  SetRegView 64
  ; the data (databases, backups, attached documents) is kept unless it is asked, twice, to delete it (never when silent)
  IfSilent keepdata
  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Keep your data?$\r$\n$\r$\nThe databases, the backups and the attached documents are in:$\r$\n$COMMONAPPDATA\MAGIS$\r$\n$\r$\nYes = keep them (recommended, so a later install finds them).$\r$\nNo = delete them too." IDYES keepdata
  MessageBox MB_YESNO|MB_ICONSTOP|MB_DEFBUTTON2 "DELETE ALL THE DATA of the centres on this computer?$\r$\n$\r$\nThis cannot be undone. Make sure you have a copy of the backups elsewhere.$\r$\n$\r$\nYes = delete everything. No = keep the data." IDNO keepdata
  RMDir /r "$COMMONAPPDATA\MAGIS"
  keepdata:
  nsExec::ExecToLog 'schtasks /End /TN "MAGIS Server"'
  nsExec::ExecToLog 'schtasks /Delete /TN "MAGIS Server" /F'
  nsExec::ExecToLog 'taskkill /F /IM magis-node.exe'
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="MAGIS Server"'
  RMDir /r "$INSTDIR"
  Delete "$DESKTOP\MAGIS Accounts.url"
  RMDir /r "$SMPROGRAMS\MAGIS"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\MAGIS Server"
  ; ProgramData\MAGIS (the database and its backups) is kept unless the person asked above to delete it.
SectionEnd
