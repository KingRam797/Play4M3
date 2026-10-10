# Invoke only after appcert querytestids from this installed kit has been reviewed.
# Never substitutes a full WACK run when selection is unavailable.
param(
  [Parameter(Mandatory=$true)][string]$PackagePath,
  [Parameter(Mandatory=$true)][int]$ResourcesTestId,
  [Parameter(Mandatory=$true)][int]$BlockedExecutablesTestId
)
$ErrorActionPreference = 'Stop'
$kit = "${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"
New-Item -ItemType Directory -Force evidence | Out-Null
$help = (& $kit /? 2>&1 | Out-String)
$help | Out-File evidence/appcert-selected-help.txt
if ($help -notmatch '-testid') { throw 'Installed WACK does not advertise selective execution' }
if ($ResourcesTestId -le 0 -or $BlockedExecutablesTestId -le 0 -or $ResourcesTestId -eq $BlockedExecutablesTestId) {
  throw 'Two distinct verified positive test IDs are required'
}
& $kit reset
if ($LASTEXITCODE -ne 0) { throw 'WACK reset failed' }
$report = Join-Path $PWD 'evidence/wack-selected.xml'
& $kit test -testid "[$ResourcesTestId,$BlockedExecutablesTestId]" -appxpackagepath (Resolve-Path $PackagePath).Path -reportoutputpath $report
$exitCode = $LASTEXITCODE
"appcert exit code: $exitCode" | Out-File evidence/wack-selected-exit.txt
if (-not (Test-Path $report)) { throw 'No selected-test report was produced' }
[xml]$xml = Get-Content $report -Raw
$tests = @($xml.SelectNodes('//TEST'))
$expected = @('App resources', 'Blocked executables')
foreach ($test in $tests) {
  $name = $test.GetAttribute('NAME')
  $result = $test.GetAttribute('RESULT')
  if (-not $result) { $result = $test.SelectSingleNode('RESULT').InnerText.Trim() }
  "$name = $result" | Tee-Object -FilePath evidence/wack-selected-summary.txt -Append
  foreach ($message in @($test.SelectNodes('MESSAGES/MESSAGE'))) {
    $message.OuterXml | Tee-Object -FilePath evidence/wack-selected-summary.txt -Append
  }
}
foreach ($name in $expected) {
  if (@($tests | Where-Object { $_.GetAttribute('NAME') -eq $name }).Count -ne 1) {
    throw "Expected exactly one result for $name"
  }
}
if (@($tests | Where-Object { $_.GetAttribute('NAME') -notin $expected }).Count) {
  throw 'Kit executed additional checks; inspect selector semantics before any further run'
}
$resource = $tests | Where-Object { $_.GetAttribute('NAME') -eq 'App resources' }
$resourceResult = $resource.GetAttribute('RESULT')
if (-not $resourceResult) { $resourceResult = $resource.SelectSingleNode('RESULT').InnerText.Trim() }
if ($resourceResult -ne 'PASS') { throw 'Resource correction did not pass its focused check' }
# Blocked-executable findings remain evidence, never silently marked resolved.
if ($exitCode -ne 0) { throw "Selected WACK invocation returned $exitCode; review captured evidence" }
