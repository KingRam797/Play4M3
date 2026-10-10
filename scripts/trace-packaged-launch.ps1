# Windows-only, read-only observation of the packaged executable and descendants.
# Never enables DevTools, Node integration, remote debugging, or disables a fuse.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force evidence | Out-Null
$source = 'P4M3-ProcessStart'
$events = [Collections.Generic.List[object]]::new()
$app = $null
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
try {
  Register-WmiEvent -Class Win32_ProcessStartTrace -SourceIdentifier $source | Out-Null
  # Positive control proves collection works. It is not part of the app tree.
  $control = Start-Process "$env:SystemRoot\System32\whoami.exe" -PassThru -Wait -RedirectStandardOutput evidence/trace-control.txt
  Start-Sleep -Seconds 2
  Drain-Starts
  if (-not ($events | Where-Object { $_.pid -eq $control.Id })) { throw 'Process collector positive control failed' }
  $exe = Resolve-Path 'apps/desktop/out/win-unpacked/Creation Station.exe'
  $env:P4M3_USER_DATA_DIR = Join-Path $env:RUNNER_TEMP 'p4m3-launch-trace'
  Remove-Item Env:P4M3_SMOKE -ErrorAction SilentlyContinue
  $app = Start-Process $exe -PassThru
  Start-Sleep -Seconds 5
  $ws = New-Object -ComObject WScript.Shell
  $activated = $ws.AppActivate($app.Id)
  if ($activated) { $ws.SendKeys('{ENTER}') }
  Start-Sleep -Seconds 5
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
    scope = 'Unpacked packaged executable: fresh launch, Enter input attempt, close. No claim that subsequent Station operations or installed-package activation were exercised.'
    unexpectedProcessNames = @($tree | Where-Object { $_.name -ne 'Creation Station.exe' })
  } | ConvertTo-Json -Depth 5 | Out-File evidence/trace-summary.json -Encoding utf8
  if (-not $alive -or -not ($tree | Where-Object { $_.pid -eq $app.Id })) { throw 'App observation incomplete' }
} finally {
  Unregister-Event -SourceIdentifier $source -ErrorAction SilentlyContinue
  Get-Event -SourceIdentifier $source -ErrorAction SilentlyContinue | Remove-Event
  if ($app -and -not $app.HasExited) { Stop-Process -Id $app.Id -ErrorAction SilentlyContinue }
}
