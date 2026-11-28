<#
.SYNOPSIS
  单平台手动登录：开一个可见的 Edge（该平台专属 profile），扫完码自动存 cookie 并关窗。

.DESCRIPTION
  平时不用跑这个。只有 .tmp\analytics-alerts.json 报了某平台「掉登录」时才跑一次，
  登录态会写进 .runtime\profiles\<平台> 与 .runtime\sessions\<平台>.json，
  之后的定时抓取会直接复用，不再打扰你。

.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File scripts\login-platform.ps1 -Platform xiaohongshu
#>
param(
  [ValidateSet('douyin', 'wechat', 'kuaishou', 'xiaohongshu')]
  [string]$Platform = 'xiaohongshu'
)

$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$SiteRoot = Split-Path -Parent $PSScriptRoot
$ProjRoot = Split-Path -Parent (Split-Path -Parent $SiteRoot)
$NodeExe = 'C:\Program Files\nodejs\node.exe'
if (-not (Test-Path -LiteralPath $NodeExe)) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $cmd) { throw '找不到 node.exe' }
  $NodeExe = $cmd.Source
}

Push-Location $SiteRoot
try {
  & $NodeExe 'scripts\collect-analytics.mjs' '--login' $Platform `
    '--profiles' (Join-Path $ProjRoot '.runtime\profiles') `
    '--sessions' (Join-Path $ProjRoot '.runtime\sessions')
  exit $LASTEXITCODE
} finally { Pop-Location }
