"""학원컴의 같은 Node 22에서 평가한다. 키는 SSH 표준 입력/프로세스 메모리로만 전달한다."""
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
parser.add_argument('--resume-from', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
parser.add_argument('--real', action='store_true')
args = parser.parse_args()
bundle = args.bundle.read_bytes()
checkpoint = (args.resume_from / 'checkpoint.json').read_text()
key = os.environ.get('OPENAI_API_KEY') if args.real else None
if args.real and not key:
    raise SystemExit('OPENAI_API_KEY missing')
args.out.mkdir(parents=True, exist_ok=True)

ps = r'''
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$siljangInput=[Console]::In.ReadLine() | ConvertFrom-Json
$siljangFolder=$PSScriptRoot
$siljangOwned=$false
$siljangExit=2
try {
  $siljangNode=Join-Path $env:LOCALAPPDATA 'siljang-tools\node-v22.23.4-win-x64\node.exe'
  if(!(Test-Path $siljangNode)){throw 'node22_missing'}
  if((& $siljangNode --version) -ne 'v22.23.4'){throw 'node22_version_mismatch'}
  $siljangOwned=(Split-Path -Leaf $siljangFolder) -match '^siljang-native-eval-[a-f0-9]{32}$'
  $siljangOwned=$siljangOwned -and ((Split-Path -Parent $siljangFolder).TrimEnd('\') -eq $env:TEMP.TrimEnd('\'))
  if(!$siljangOwned){throw 'invalid_native_folder'}
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
  $siljangArgs=@('--model','openai/gpt-6-luna','--max-krw','700','--max-failures','2','--interval-ms','30000','--resume-from',$siljangPrior,'--out',$siljangResults)
  if($siljangInput.real){$env:OPENAI_API_KEY=$siljangInput.key;$siljangArgs+=@('--real')}
  else{$env:OPENAI_API_KEY=$null;$siljangArgs+=@('--dry-run')}
  @{event='native_eval_start';real=$siljangInput.real;node='v22.23.4';bundleSha256=$siljangHash}|ConvertTo-Json -Compress
  $ErrorActionPreference='Continue'
  & $siljangNode $siljangBundle @siljangArgs 2>$null
  $siljangExit=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  foreach($siljangName in @('run.json','results.jsonl','checkpoint.json','summary.md','review.md')){
    $siljangPath=Join-Path $siljangResults $siljangName
    if(Test-Path $siljangPath){@{event='artifact';name=$siljangName;data=[Convert]::ToBase64String([IO.File]::ReadAllBytes($siljangPath))}|ConvertTo-Json -Compress}
  }
  @{event='native_eval_finished';cliExit=$siljangExit}|ConvertTo-Json -Compress
} catch {
  $siljangCode=if($_.Exception.Message -match '^[a-z_]+$'){$_.Exception.Message}else{'native_eval_failed'}
  @{event='native_eval_failed';code=$siljangCode}|ConvertTo-Json -Compress
  $siljangExit=2
} finally {
  $env:OPENAI_API_KEY=$null
  if($siljangOwned -and (Test-Path $siljangFolder)){Remove-Item -LiteralPath $siljangFolder -Recurse -Force -ErrorAction SilentlyContinue}
}
exit $siljangExit
'''
payload = {
    'real': args.real,
    'key': key,
    'bundleSha256': hashlib.sha256(bundle).hexdigest(),
}
setup = r"""[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);$ErrorActionPreference='Stop';$siljangFolder=Join-Path $env:TEMP ('siljang-native-eval-'+[guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $siljangFolder|Out-Null;@{folder=$siljangFolder}|ConvertTo-Json -Compress"""
setup_encoded = base64.b64encode(setup.encode('utf-16le')).decode()
setup_result = subprocess.run([
    'ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'academy-pc',
    'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', setup_encoded,
], capture_output=True, timeout=30)
if setup_result.returncode:
    raise SystemExit('native folder setup failed')
metadata = next(json.loads(line) for line in setup_result.stdout.decode('utf-8-sig').splitlines() if line.startswith('{'))
remote = metadata['folder'].replace('\\', '/')
(args.out / 'native-state.json').write_text(json.dumps({'folder': remote, 'bundleSha256': payload['bundleSha256']}))
script_path = args.out / 'driver.ps1'
script_path.write_text(ps, encoding='utf-8-sig')
transfer = subprocess.run([
    'scp', '-q', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
    str(args.bundle), str(script_path), str(args.resume_from / 'checkpoint.json'), f'academy-pc:{remote}/',
], capture_output=True, timeout=60)
if transfer.returncode:
    print(json.dumps({'event': 'native_transfer_failed', 'exit': transfer.returncode}))
    raise SystemExit(2)
print(json.dumps({'event': 'native_transfer_done', 'bundleBytes': len(bundle)}), flush=True)
bootstrap = r"""$ErrorActionPreference='Stop';$siljangLaunch=[Console]::In.ReadLine()|ConvertFrom-Json;& $siljangLaunch.driver;exit $LASTEXITCODE"""
encoded = base64.b64encode(bootstrap.encode('utf-16le')).decode()
process = subprocess.Popen([
    'ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'academy-pc',
    'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded,
], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
process.stdin.write((json.dumps({'driver': remote + '/driver.ps1'}) + '\n').encode())
process.stdin.write((json.dumps(payload) + '\n').encode())
process.stdin.close()
allowed = {'run.json', 'results.jsonl', 'checkpoint.json', 'summary.md', 'review.md'}
with (args.out / 'native-cli.log').open('w') as log:
    for raw in process.stdout:
        line = raw.decode('utf-8-sig', errors='replace').rstrip()
        try:
            event = json.loads(line)
        except ValueError:
            safe = line.replace(key, '[redacted]') if key else line
            log.write(safe + '\n')
            log.flush()
            if safe.startswith(('모드 ', '  진행 ', '멈춤', '시작하지 않음')):
                print(safe, flush=True)
            continue
        if not isinstance(event, dict):
            continue
        if event.get('event') == 'artifact':
            name = event.get('name')
            if name not in allowed:
                raise ValueError('unexpected artifact')
            data = base64.b64decode(event['data'], validate=True)
            if key and key.encode() in data:
                raise ValueError('credential in artifact refused')
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
