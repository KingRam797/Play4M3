# Windows-only, read-only observation of the packaged executable and descendants.
# Never enables DevTools, Node integration, remote debugging, or disables a fuse.
param([string]$ExecutablePath = 'apps/desktop/out/win-unpacked/Creation Station.exe')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class TraceWindowInput {
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wparam, IntPtr lparam);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
}
'@
New-Item -ItemType Directory -Force evidence | Out-Null
$source = 'P4M3-ProcessStart'
$events = [Collections.Generic.List[object]]::new()
$app = $null
$stages = [Collections.Generic.List[string]]::new()
function Drain-Starts {
  foreach ($event in @(Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue)) {
    $p = $event.SourceEventArgs.NewEvent
    $events.Add([pscustomobject]@{
      time = $event.TimeGenerated.ToUniversalTime().ToString('o')
      pid = [int]$p.ProcessID
      parent = [int]$p.ParentProcessID
      name = [string]$p.ProcessName
    })
    Remove-Event -EventIdentifier $event.EventIdentifier
  }
}
function Find-Control([string]$NamePattern, [System.Windows.Automation.ControlType]$Type) {
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    $app.Refresh()
    $root = [Windows.Automation.AutomationElement]::FromHandle($app.MainWindowHandle)
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ControlTypeProperty, $Type)
    foreach ($item in $root.FindAll([Windows.Automation.TreeScope]::Descendants, $condition)) {
      if ($item.Current.Name -match $NamePattern -and $item.Current.IsEnabled) { return $item }
    }
    Start-Sleep -Milliseconds 500
  }
  $root.FindAll([Windows.Automation.TreeScope]::Descendants, [Windows.Automation.Condition]::TrueCondition) |
    ForEach-Object { [pscustomobject]@{ name=$_.Current.Name; type=$_.Current.ControlType.ProgrammaticName; enabled=$_.Current.IsEnabled } } |
    ConvertTo-Json -Depth 3 | Out-File evidence/ui-controls-at-failure.json -Encoding utf8
  throw "UI control not found: $NamePattern"
}
function Invoke-Control([string]$NamePattern) {
  $item = Find-Control $NamePattern ([Windows.Automation.ControlType]::Button)
  $pattern = $item.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern)
  $pattern.Invoke()
  Start-Sleep -Milliseconds 500
}
try {
  Register-WmiEvent -Class Win32_ProcessStartTrace -SourceIdentifier $source | Out-Null
  # Positive control proves collection works. It is not part of the app tree.
  $control = Start-Process "$env:SystemRoot\System32\whoami.exe" -PassThru -Wait -RedirectStandardOutput evidence/trace-control.txt
  Start-Sleep -Seconds 2
  Drain-Starts
  if (-not ($events | Where-Object { $_.pid -eq $control.Id })) { throw 'Process collector positive control failed' }
  $exe = Resolve-Path $ExecutablePath
  $env:P4M3_USER_DATA_DIR = Join-Path $env:RUNNER_TEMP 'p4m3-launch-trace'
  Remove-Item Env:P4M3_SMOKE -ErrorAction SilentlyContinue
  $app = Start-Process $exe -ArgumentList '--force-renderer-accessibility' -PassThru
  Start-Sleep -Seconds 5
  $ws = New-Object -ComObject WScript.Shell
  $activated = $ws.AppActivate($app.Id)
  $app.Refresh()
  $hwnd = $app.MainWindowHandle
  if ($hwnd -eq [IntPtr]::Zero) { throw 'Application has no main window' }
  # The trace snapshot showed the renderer still on its ready canvas: posting
  # keys to Electron's top-level HWND does not target the renderer input widget.
  $canvas = Find-Control '^Loading screen' ([Windows.Automation.ControlType]::Image)
  $rect = $canvas.Current.BoundingRectangle
  $null = [TraceWindowInput]::SetCursorPos([int]($rect.X + $rect.Width / 2), [int]($rect.Y + $rect.Height / 2))
  [TraceWindowInput]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero)
  [TraceWindowInput]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 500
  $ws.SendKeys('{ENTER}')
  $stages.Add('Fresh launch and Enter input')
  $check = Find-Control 'I own this game' ([Windows.Automation.ControlType]::CheckBox)
  $check.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Toggle()
  Invoke-Control '^Continue$'
  $stages.Add('Attest for repository demo fixture')
  Invoke-Control '^Open sample game$'
  $stages.Add('Create sample project')
  Invoke-Control 'player_jump'
  $stages.Add('Explain player_jump')
  Invoke-Control '^Make the jump higher$'
  $stages.Add('Propose demo patch')
  Invoke-Control '^Reject$'
  $stages.Add('Reject proposed patch')
  Invoke-Control '^Activity log'
  $stages.Add('Open activity log')
  Start-Sleep -Seconds 2
  Drain-Starts
  $app.Refresh()
  $alive = -not $app.HasExited
  if ($alive) { $null = $app.CloseMainWindow(); $null = $app.WaitForExit(5000) }
  Start-Sleep -Seconds 2
  Drain-Starts
  $ids = [Collections.Generic.HashSet[int]]::new()
  $null = $ids.Add($app.Id)
  do {
    $changed = $false
    foreach ($e in $events) {
      if ($ids.Contains($e.parent) -and $ids.Add($e.pid)) { $changed = $true }
    }
  } while ($changed)
  $tree = @($events | Where-Object { $ids.Contains($_.pid) })
  $tree | ConvertTo-Json -Depth 4 | Out-File evidence/app-process-tree.json -Encoding utf8
  [pscustomobject]@{
    controlObserved = $true
    rootPid = $app.Id
    appAliveAfterObservation = $alive
    enterSent = $activated
    stages = @($stages)
    scope = 'Unpacked packaged executable with accessibility enabled: launch, attestation for demo, sample project, explanation, proposal, rejection, activity log, close. Does not exercise installed-package activation, native approval, real analysis, or a physical controller.'
    unexpectedProcessNames = @($tree | Where-Object { $_.name -ne 'Creation Station.exe' })
  } | ConvertTo-Json -Depth 5 | Out-File evidence/trace-summary.json -Encoding utf8
  if (-not $alive -or -not ($tree | Where-Object { $_.pid -eq $app.Id })) { throw 'App observation incomplete' }
} finally {
  Drain-Starts
  if ($app -and -not (Test-Path evidence/trace-summary.json)) {
    $partialIds = [Collections.Generic.HashSet[int]]::new()
    $null = $partialIds.Add($app.Id)
    do {
      $added = $false
      foreach ($e in $events) { if ($partialIds.Contains($e.parent) -and $partialIds.Add($e.pid)) { $added = $true } }
    } while ($added)
    @($events | Where-Object { $partialIds.Contains($_.pid) }) | ConvertTo-Json -Depth 4 | Out-File evidence/app-process-tree-partial.json -Encoding utf8
  }
  $stages | ConvertTo-Json | Out-File evidence/trace-stages.json -Encoding utf8
  Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue
  Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -ErrorAction SilentlyContinue }
}
