"""학원컴의 같은 Node 22에서 평가한다. 기존 키는 학원컴 프로세스/사용자 환경에서만 읽는다."""
import argparse
import base64
import hashlib
import json
import os
import re
import subprocess
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--bundle', required=True, type=Path)
parser.add_argument('--resume-from', type=Path)
parser.add_argument('--out', required=True, type=Path)
mode = parser.add_mutually_exclusive_group()
mode.add_argument('--real', action='store_true')
mode.add_argument('--native-auth-probe', choices=['clean', 'artifact-rejection'])
args = parser.parse_args()
bundle = args.bundle.read_bytes()
if not args.native_auth_probe and (args.resume_from is None or not (args.resume_from / 'checkpoint.json').is_file()):
    parser.error('--resume-from requires checkpoint.json')
args.out.mkdir(parents=True, exist_ok=True)
transport_env = {key: value for key, value in os.environ.items()
                 if key not in {'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY'}}

ps = r'''
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$siljangFolder=[IO.Path]::GetFullPath($PSScriptRoot)
$siljangOwned=$false
$siljangExit=2
$siljangApiKey=$null
try {
  $siljangOwned=(Split-Path -Leaf $siljangFolder) -match '^siljang-native-eval-[a-f0-9]{32}$'
  $siljangParent=[IO.Path]::GetFullPath((Split-Path -Parent $siljangFolder)).TrimEnd('\','/')
  $siljangTemp=[IO.Path]::GetFullPath($env:TEMP).TrimEnd('\','/')
  $siljangOwned=$siljangOwned -and ($siljangParent -eq $siljangTemp)
  if(!$siljangOwned){throw 'invalid_native_folder'}
  $siljangInput=[Console]::In.ReadLine() | ConvertFrom-Json
  $siljangNode=Join-Path $env:LOCALAPPDATA 'siljang-tools\node-v22.23.4-win-x64\node.exe'
  if(!(Test-Path $siljangNode)){throw 'node22_missing'}
  if((& $siljangNode --version) -ne 'v22.23.4'){throw 'node22_version_mismatch'}
  $siljangBundle=Join-Path $siljangFolder 'eval.mjs'
  $siljangHash=(Get-FileHash -Algorithm SHA256 -LiteralPath $siljangBundle).Hash.ToLowerInvariant()
  if($siljangHash -ne $siljangInput.bundleSha256){throw 'bundle_hash_mismatch'}
  $siljangPrior=$siljangFolder
  $siljangResults=Join-Path $siljangFolder 'results'
  foreach($siljangName in @('LANGSMITH_TRACING','LANGSMITH_TRACING_V2','LANGCHAIN_TRACING_V2','LANGCHAIN_TRACING','LANGCHAIN_VERBOSE','LANGSMITH_GATEWAY','LANGSMITH_API_KEY','LANGCHAIN_API_KEY','LANGSMITH_GATEWAY_API_KEY')){
    [Environment]::SetEnvironmentVariable($siljangName,$null,'Process')
  }
  $env:AI_USD_KRW='1450.00'
  $env:AI_USD_KRW_DATE='2026-11-14'
  $siljangArgs=@('--model','openai/gpt-6-luna','--max-krw','700','--max-failures','2','--out',$siljangResults)
  if($siljangInput.nativeAuthProbe){
    $env:OPENAI_API_KEY='example-native-canary-'+[guid]::NewGuid().ToString('N')
    $siljangArgs+=@('--interval-ms','0')
  } else {$siljangArgs+=@('--interval-ms','30000','--resume-from',$siljangPrior)}
  if($siljangInput.real -or $siljangInput.nativeAuthProbe){
    $siljangApiKey=$env:OPENAI_API_KEY
    if(!$siljangApiKey){$siljangApiKey=[Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')}
    if(!$siljangApiKey){throw 'native_openai_key_missing'}
    $env:OPENAI_API_KEY=$siljangApiKey
    if($siljangInput.real){$siljangArgs+=@('--real')}
  }
  else{$env:OPENAI_API_KEY=$null;$siljangArgs+=@('--dry-run')}
  @{event='native_eval_start';real=$siljangInput.real;node='v22.23.4';bundleSha256=$siljangHash}|ConvertTo-Json -Compress
  $ErrorActionPreference='Continue'
  $siljangSafeOutput={
    $siljangLine=[string]$_
    if($siljangApiKey){$siljangLine=$siljangLine.Replace($siljangApiKey,'[credential]')}
    Write-Output $siljangLine
  }
  if($siljangInput.nativeAuthProbe){('native_auth_probe_stdout='+$siljangApiKey) | ForEach-Object $siljangSafeOutput}
  & $siljangNode $siljangBundle @siljangArgs 2>$null | ForEach-Object $siljangSafeOutput
  $siljangExit=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  if($siljangInput.nativeAuthProbe -eq 'artifact-rejection'){
    Add-Content -LiteralPath (Join-Path $siljangResults 'run.json') -Value $siljangApiKey -Encoding UTF8
  }
  foreach($siljangName in @('run.json','results.jsonl','checkpoint.json','summary.md','review.md')){
    $siljangPath=Join-Path $siljangResults $siljangName
    if(Test-Path $siljangPath){
      $siljangBytes=[IO.File]::ReadAllBytes($siljangPath)
      if($siljangApiKey -and [Text.Encoding]::UTF8.GetString($siljangBytes).Contains($siljangApiKey)){throw 'credential_in_artifact_refused'}
      @{event='artifact';name=$siljangName;data=[Convert]::ToBase64String($siljangBytes)}|ConvertTo-Json -Compress
    }
  }
  @{event='native_eval_finished';cliExit=$siljangExit}|ConvertTo-Json -Compress
} catch {
  $siljangCode=if($_.Exception.Message -match '^[a-z0-9_]+$'){$_.Exception.Message}else{'native_eval_failed'}
  @{event='native_eval_failed';code=$siljangCode}|ConvertTo-Json -Compress
  $siljangExit=2
} finally {
  $env:OPENAI_API_KEY=$null
  $siljangApiKey=$null
  if($siljangOwned -and (Test-Path $siljangFolder)){Remove-Item -LiteralPath $siljangFolder -Recurse -Force -ErrorAction SilentlyContinue}
}
exit $siljangExit
'''
payload = {
    'real': args.real,
    'bundleSha256': hashlib.sha256(bundle).hexdigest(),
}
if args.native_auth_probe:
    payload['nativeAuthProbe'] = args.native_auth_probe
setup = r"""[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';$siljangPreflight=[Console]::In.ReadLine()|ConvertFrom-Json;if($siljangPreflight.real -and !$env:OPENAI_API_KEY -and ![Environment]::GetEnvironmentVariable('OPENAI_API_KEY','User')){Write-Output '{"event":"native_openai_key_missing"}';exit 2};$siljangFolder=Join-Path $env:TEMP ('siljang-native-eval-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $siljangFolder|Out-Null;@{folder=$siljangFolder}|ConvertTo-Json -Compress"""
setup_encoded = base64.b64encode(setup.encode('utf-16le')).decode()
try:
    setup_result = subprocess.run([
        'ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'academy-pc',
        'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', setup_encoded,
    ], input=(json.dumps({'real':args.real})+'\n').encode(), capture_output=True, timeout=30, env=transport_env)
except (OSError, subprocess.TimeoutExpired):
    print(json.dumps({'event':'native_setup_transport_failed'}), flush=True)
    raise SystemExit(2)
if setup_result.returncode:
    if b'native_openai_key_missing' in setup_result.stdout:
        print(json.dumps({'event':'native_openai_key_missing'}),flush=True)
    else:
        print(json.dumps({'event':'native_folder_setup_failed'}),flush=True)
    raise SystemExit(2)
metadata = next(json.loads(line) for line in setup_result.stdout.decode('utf-8-sig').splitlines() if line.startswith('{'))
remote = metadata['folder'].replace('\\', '/')
(args.out / 'native-state.json').write_text(json.dumps({'folder': remote, 'bundleSha256': payload['bundleSha256']}), encoding='utf-8')
script_path = args.out / 'driver.ps1'
script_path.write_text(ps, encoding='utf-8-sig')
files = [str(args.bundle), str(script_path)]
if not args.native_auth_probe:
    files.append(str(args.resume_from / 'checkpoint.json'))
try:
    transfer = subprocess.run([
        'scp', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        *files, f'academy-pc:{remote}/',
    ], capture_output=True, timeout=60, env=transport_env)
except (OSError, subprocess.TimeoutExpired):
    transfer = subprocess.CompletedProcess(['scp'], 2)
if transfer.returncode:
    print(json.dumps({'event': 'native_transfer_failed', 'exit': transfer.returncode}))
    cleanup = r"""$ErrorActionPreference='Stop';$p=[Console]::In.ReadLine()|ConvertFrom-Json;$f=[IO.Path]::GetFullPath([string]$p.folder);$owned=(Split-Path -Leaf $f) -match '^siljang-native-eval-[a-f0-9]{32}$';$owned=$owned -and ((Split-Path -Parent $f).TrimEnd('\') -eq $env:TEMP.TrimEnd('\'));if(!$owned){exit 2};if(Test-Path -LiteralPath $f){Remove-Item -LiteralPath $f -Recurse -Force};exit 0"""
    cleanup_result = subprocess.run([
        'ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'academy-pc',
        'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', base64.b64encode(cleanup.encode('utf-16le')).decode(),
    ], input=(json.dumps({'folder': remote})+'\n').encode(), capture_output=True, timeout=30, env=transport_env)
    print(json.dumps({'event':'native_transfer_cleanup','success':cleanup_result.returncode == 0}))
    raise SystemExit(2)
print(json.dumps({'event': 'native_transfer_done', 'bundleBytes': len(bundle)}), flush=True)
bootstrap = r"""$ErrorActionPreference='Stop';$siljangLaunch=[Console]::In.ReadLine()|ConvertFrom-Json;& $siljangLaunch.driver;exit $LASTEXITCODE"""
encoded = base64.b64encode(bootstrap.encode('utf-16le')).decode()
process = subprocess.Popen([
    'ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'academy-pc',
    'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=transport_env)
process.stdin.write((json.dumps({'driver': remote + '/driver.ps1'}) + '\n').encode())
process.stdin.write((json.dumps(payload) + '\n').encode())
process.stdin.close()
allowed = {'run.json', 'results.jsonl', 'checkpoint.json', 'summary.md', 'review.md'}
with (args.out / 'native-cli.log').open('w', encoding='utf-8') as log:
    for raw in process.stdout:
        line = raw.decode('utf-8-sig', errors='replace').rstrip()
        try:
            event = json.loads(line)
        except ValueError:
            safe = line
            log.write(safe + '\n')
            log.flush()
            if safe.startswith(('모드 ', '  진행 ', '모델 호출 실패로', '비용 상한', 'Retry-After ', '시작하지 않음', 'dry-run:', 'native_auth_probe_stdout=')) or '도중에 멈춤' in safe:
                print(safe, flush=True)
            continue
        if not isinstance(event, dict):
            continue
        if event.get('event') == 'artifact':
            name = event.get('name')
            if name not in allowed:
                raise ValueError('unexpected artifact')
            data = base64.b64decode(event['data'], validate=True)
            (args.out / name).write_bytes(data)
            print(json.dumps({'event': 'artifact_saved', 'name': name, 'bytes': len(data)}), flush=True)
        elif event.get('event') in {'native_eval_start', 'native_eval_finished', 'native_eval_failed'}:
            print(json.dumps(event), flush=True)
code = process.wait()
stderr = process.stderr.read().decode('utf-8-sig', errors='replace')
if stderr and not args.real:
    diagnostic = re.sub(r'C:\\Users\\[^\\\s]+', '[user]', stderr)
    print(json.dumps({'event': 'dry_stderr', 'diagnostic': diagnostic[:1000]}), flush=True)
print(json.dumps({'event': 'ssh_finished', 'exit': code}), flush=True)
raise SystemExit(code)
