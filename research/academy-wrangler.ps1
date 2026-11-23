function Set-SiljangWranglerEnvironment {
  $env:SILJANG_WRANGLER_CLI = Join-Path $env:LOCALAPPDATA 'siljang-tools\node_modules\wrangler\wrangler-dist\cli.js'
  $env:WRANGLER_SEND_METRICS = 'false'
  $env:CI = '1'
  if (-not $env:CLOUDFLARE_API_TOKEN) {
    $env:CLOUDFLARE_API_TOKEN = [Environment]::GetEnvironmentVariable('CLOUDFLARE_API_TOKEN', 'User')
  }
}

function Assert-SiljangWranglerLogin {
  if (-not (Test-Path -LiteralPath $env:SILJANG_WRANGLER_CLI -PathType Leaf)) {
    Write-Output '{"event":"cached_cli_missing"}'
    exit 1
  }

  $ErrorActionPreference = 'Continue'
  $siljangWhoami = & node $env:SILJANG_WRANGLER_CLI whoami --json 2>$null
  $siljangWhoamiExit = $LASTEXITCODE
  $siljangIdentity = ($siljangWhoami -join "`n") | ConvertFrom-Json -ErrorAction SilentlyContinue
  if ($siljangIdentity.loggedIn -eq $false) {
    @{ event='academy_auth_missing'; message='학원컴에 Cloudflare 로그인이 없음' } | ConvertTo-Json -Compress
    exit 1
  }
  if ($siljangWhoamiExit -ne 0 -or $siljangIdentity.loggedIn -ne $true) {
    Write-Output '{"event":"academy_whoami_failed"}'
    exit 1
  }
  if ($siljangIdentity.authType -notin @('OAuth Token', 'User API Token', 'Account API Token')) {
    Write-Output '{"event":"academy_auth_unsupported"}'
    exit 1
  }
}
