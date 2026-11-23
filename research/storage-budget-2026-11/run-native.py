import base64
import json
import os
import subprocess
from pathlib import Path

repo = Path(__file__).resolve().parents[2]
folder = repo / 'research/storage-budget-2026-11'
driver = r'''
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const cli = process.env.SILJANG_WRANGLER_CLI;
const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', timeout: 15000 });
console.log(JSON.stringify({ event: 'native_cli', node: process.version, wrangler: /\b\d+\.\d+\.\d+\b/.exec(version.stdout)?.[0] ?? null }));
const peer = 'siljang-storage-budget-peer';
const harness = 'siljang-storage-budget-harness';
const emit = value => console.log(JSON.stringify(value));
const base = { compatibility_date: '2026-11-01', workers_dev: false, preview_urls: false };
const vars = { PROBE_URL: process.env.SILJANG_PROBE_URL };
writeFileSync('peer.json', JSON.stringify({ ...base, name: peer, main: 'peer.mjs', vars }));
writeFileSync('harness.json', JSON.stringify({ ...base, name: harness, main: 'harness.mjs', vars,
  services: [{ binding: 'PEER', service: peer, entrypoint: 'StorageBudgetPeer' }] }));
writeFileSync('preview.json', JSON.stringify({ ...base, name: 'siljang-storage-budget-preview', main: 'preview.mjs',
  services: [{ binding: 'HARNESS', service: harness, entrypoint: 'StorageBudgetHarness' }] }));
for (const name of ['peer', 'harness']) {
  emit({ event: 'deploy_start', target: name });
  const result = spawnSync(process.execPath, [cli, 'deploy', '--config', `${name}.json`],
    { encoding: 'utf8', timeout: 65000, maxBuffer: 2097152 });
  const raw = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  emit({ event: 'deploy_result', target: name, exit: result.status,
    apiCode: /\[code:\s*(\d+)\]/.exec(raw)?.[1] ?? null,
    diagnostic: raw.split('\n').filter(line => /ERROR|Error:|error:/.test(line)).slice(0, 3).join(' ').replaceAll(process.env.CLOUDFLARE_API_TOKEN, '[credential]').replaceAll(process.env.CLOUDFLARE_ACCOUNT_ID, '[account]').replace(/https?:\/\/\S+/g, '[url]').replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, '[email]').slice(0, 450) });
  if (result.error || result.status !== 0) process.exit(1);
}
let previewOutput = '';
const preview = spawn(process.execPath, [cli, 'dev', '--remote', '--ip', '127.0.0.1', '--port', '18438',
  '--config', 'preview.json'], { stdio: ['ignore', 'pipe', 'pipe'] });
preview.stdout.on('data', data => { previewOutput += data.toString(); });
preview.stderr.on('data', data => { previewOutput += data.toString(); });
try {
  let ready = false;
  for (let i = 0; i < 75; i++) {
    if (preview.exitCode !== null) break;
    try {
      const response = await fetch('http://127.0.0.1:18438/ready', { signal: AbortSignal.timeout(1500) });
      if (response.ok && (await response.json()).ready === true) { ready = true; break; }
    } catch {}
    await setTimeout(1000);
  }
  emit({ event: 'preview_ready', ready, exit: preview.exitCode,
    apiCode: /\[code:\s*(\d+)\]/.exec(previewOutput)?.[1] ?? null });
  if (!ready) { process.exitCode = 1; }
  else for (const mode of ['direct49', 'direct51', 'peer30twice', 'peer51']) {
    emit({ event: 'measure_start', mode });
    try {
      const response = await fetch(`http://127.0.0.1:18438/${mode}`, { signal: AbortSignal.timeout(65000) });
      const value = await response.json();
      const safe = result => ({ completed: result.completed, limited: result.limited, failed: result.failed });
      const data = mode === 'peer30twice' ? { first: safe(value.first), second: safe(value.second) } : safe(value);
      emit({ event: 'measure_result', mode, status: response.status, data });
    } catch { emit({ event: 'measure_failed', mode }); process.exitCode = 1; }
  }
} finally {
  const stopped = spawnSync('taskkill', ['/PID', String(preview.pid), '/T', '/F'], { encoding: 'utf8', timeout: 10000 });
  emit({ event: 'preview_stopped', exit: stopped.status });
}
'''
ps = r'''
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$siljangInput=[Console]::In.ReadLine() | ConvertFrom-Json
$env:CLOUDFLARE_ACCOUNT_ID=$siljangInput.account
$env:CLOUDFLARE_API_TOKEN=$siljangInput.token
$env:WRANGLER_SEND_METRICS='false'
$env:WRANGLER_LOG='error'
$env:SILJANG_PROBE_URL=$siljangInput.probeUrl
$env:SILJANG_WRANGLER_CLI=Join-Path $env:LOCALAPPDATA 'siljang-tools\node_modules\wrangler\wrangler-dist\cli.js'
$siljangFolder=Join-Path $env:TEMP ('siljang-storage-budget-'+[guid]::NewGuid().ToString('N'))
try {
  if(!(Test-Path $env:SILJANG_WRANGLER_CLI)){throw 'cached_cli_missing'}
  New-Item -ItemType Directory -Path $siljangFolder | Out-Null
  $siljangUtf8=New-Object System.Text.UTF8Encoding($false)
  foreach($siljangFile in $siljangInput.files.PSObject.Properties){
    [IO.File]::WriteAllText((Join-Path $siljangFolder $siljangFile.Name),$siljangFile.Value,$siljangUtf8)
  }
  Set-Location -LiteralPath $siljangFolder
  $ErrorActionPreference='Continue'
  & node (Join-Path $siljangFolder 'driver.mjs') 2>$null
  $siljangExit=$LASTEXITCODE
  exit $siljangExit
} catch {
  Write-Output '{"event":"native_setup_failed"}'
  exit 1
} finally {
  Set-Location $env:TEMP
  if(Test-Path $siljangFolder){Remove-Item -LiteralPath $siljangFolder -Recurse -Force -ErrorAction SilentlyContinue}
}
'''
payload = {
    'account': os.environ.get('CLOUDFLARE_ACCOUNT_ID'),
    'token': os.environ.get('CLOUDFLARE_API_TOKEN'),
    'probeUrl': os.environ.get('SILJANG_STORAGE_PROBE_URL'),
    'files': {name: (folder / name).read_text() for name in ['measure.mjs', 'peer.mjs', 'harness.mjs', 'preview.mjs']},
}
payload['files']['driver.mjs'] = driver
if not payload['account'] or not payload['token'] or not payload['probeUrl']:
    print(json.dumps({'event': 'credentials_absent'}))
    raise SystemExit(1)
encoded = base64.b64encode(ps.encode('utf-16le')).decode()
try:
    result = subprocess.Popen(['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=12', 'academy-pc',
        'powershell', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    result.stdin.write((json.dumps(payload) + '\n').encode())
    result.stdin.close()
    for line in result.stdout:
        try:
            value = json.loads(line.decode('utf-8-sig'))
            if isinstance(value, dict) and value.get('event'):
                print(json.dumps(value), flush=True)
        except (ValueError, UnicodeDecodeError):
            pass
    code = result.wait(timeout=15)
    print(json.dumps({'event': 'native_finished', 'ssh_exit': code}), flush=True)
    raise SystemExit(code)
except subprocess.TimeoutExpired:
    print(json.dumps({'event': 'native_timeout'}), flush=True)
    raise SystemExit(1)
