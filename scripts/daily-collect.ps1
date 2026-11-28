<#
.SYNOPSIS
  四平台后台数据定时抓取 → 写站点快照 → 只提交有数据的部分 → 推送部署。

.DESCRIPTION
  由 Windows 任务计划程序在 09:00 / 22:00 调用。流程：
    1. 逐平台拉起独立 Edge 实例（各自 profile、各自端口），抓完立刻关掉
    2. node scripts\collect-analytics.mjs 写 public\data\analytics.json（带每平台 status）
    3. 单平台 0 条 → 判掉登录，写 .tmp\analytics-alerts.json，只提示那一个平台
    4. 至少一个平台有数才 commit + push（直连优先，失败再拉 Clash 走 7897）
  日志固定 .tmp\analytics-collect.log；登录态与 cookie 备份放 .runtime（不入库）。

.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File scripts\daily-collect.ps1
  pwsh -ExecutionPolicy Bypass -File scripts\daily-collect.ps1 -Only xiaohongshu -DryRun
#>
param(
  [switch]$DryRun,
  [string]$Only = '',
  [switch]$Visible,
  [switch]$NoPush,
  [string]$Proxy = 'http://127.0.0.1:7897'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# 外部程序吐 UTF-8，控制台默认 GBK，不统一会导致日志与 commit message 乱码
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$SiteRoot = Split-Path -Parent $PSScriptRoot
$ProjRoot = Split-Path -Parent (Split-Path -Parent $SiteRoot)
$LogPath = Join-Path $ProjRoot '.tmp\analytics-collect.log'
$AlertPath = Join-Path $ProjRoot '.tmp\analytics-alerts.json'
$Profiles = Join-Path $ProjRoot '.runtime\profiles'
$Sessions = Join-Path $ProjRoot '.runtime\sessions'
$JsonPath = Join-Path $SiteRoot 'public\data\analytics.json'
$NodeExe = 'C:\Program Files\nodejs\node.exe'
$GitExe = 'C:\Program Files\Git\cmd\git.exe'

New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force | Out-Null
New-Item -ItemType Directory -Path $Sessions -Force | Out-Null

# 日志按 5MB 轮转一份，避免无限增长
try {
  if ((Test-Path -LiteralPath $LogPath) -and (Get-Item -LiteralPath $LogPath).Length -gt 5MB) {
    Move-Item -LiteralPath $LogPath -Destination "$LogPath.1" -Force
  }
} catch {}

function Write-Log([string]$Msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Msg
  Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  Write-Host $line
}

function Invoke-Native([string]$Exe, [string[]]$ArgList) {
  $ErrorActionPreference = 'Continue'
  $out = & $Exe @ArgList 2>&1
  $script:NativeExit = $LASTEXITCODE
  return @($out | ForEach-Object { $_.ToString() })
}

# ---------- 代理（只服务 git push） ----------
$ClashExe = 'C:\Program Files\Clash Verge\clash-verge.exe'

function Test-ProxyPort {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', 7897)
    $c.Close()
    return $true
  } catch { return $false }
}

function Start-ProxyIfNeeded {
  if (Test-ProxyPort) { Write-Log '代理 7897 在线'; return $true }
  if (-not (Test-Path -LiteralPath $ClashExe)) { Write-Log '找不到 Clash Verge，无法开代理'; return $false }
  Write-Log '代理 7897 不在线，启动 Clash Verge'
  try { Start-Process -FilePath $ClashExe -WindowStyle Minimized | Out-Null } catch { Write-Log ('启动 Clash 失败: ' + $_.Exception.Message); return $false }
  for ($i = 0; $i -lt 25; $i++) {
    Start-Sleep -Seconds 1
    if (Test-ProxyPort) { Write-Log ('代理 7897 就绪（等了 ' + ($i + 1) + ' 秒）'); return $true }
  }
  Write-Log '代理 25 秒内没起来'
  return $false
}

# 收尾：只杀挂在 .runtime\profiles 下的 Edge，别碰用户自己的浏览器
function Stop-EdgeByProfile {
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Profiles*" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
  if (-not (Test-Path -LiteralPath $NodeExe)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { throw '找不到 node.exe' }
    $NodeExe = $cmd.Source
  }

  # ---------- 1. 抓数 ----------
  $nodeArgs = @(
    'scripts\collect-analytics.mjs',
    '--profiles', $Profiles,
    '--sessions', $Sessions,
    '--out', $JsonPath
  )
  if ($Only) { $nodeArgs += @('--only', $Only) }
  if ($Visible) { $nodeArgs += '--visible' }

  if ($DryRun) {
    Write-Log ('[dry] node ' + ($nodeArgs -join ' '))
  } else {
    Push-Location $SiteRoot
    try {
      Write-Log '开始抓取四平台（逐平台独立实例）…'
      & $NodeExe @nodeArgs 2>&1 | ForEach-Object { Write-Log ('  ' + $_) }
      $code = $LASTEXITCODE
      Write-Log "采集脚本退出码 $code"
    } finally { Pop-Location }
  }

  # ---------- 2. 校验 & 单平台告警 ----------
  $alerts = @()
  if (-not $DryRun) {
    if (-not (Test-Path -LiteralPath $JsonPath)) { throw "没有生成 $JsonPath" }
    $j = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $rows = @(
      [pscustomobject]@{ n = '抖音'; k = 'douyin' },
      [pscustomobject]@{ n = '微信'; k = 'wechat' },
      [pscustomobject]@{ n = '快手'; k = 'kuaishou' },
      [pscustomobject]@{ n = '小红书'; k = 'xiaohongshu' }
    )
    # 只跑了某一家时，校验与告警都只看这一家，不拿没跑的三家凑「全零」
    if ($Only) { $rows = @($rows | Where-Object { $_.k -eq $Only }) }
    $parts = @()
    foreach ($r in $rows) {
      $st = $j.status.($r.k)
      $count = if ($st -and $null -ne $st.count) { [int]$st.count } else { @($j.($r.k).works).Count }
      $state = if ($st) { [string]$st.state } else { 'empty' }
      $parts += "$($r.n) $count [$state]"
      if ($count -le 0) {
        $fix = if ($state -eq 'drift') { '页面结构变了：改解析器，别去扫码' } else {
          switch ($r.k) {
            'xiaohongshu' { 'pwsh scripts\login-platform.ps1 -Platform xiaohongshu' }
            'douyin' { 'pwsh scripts\login-platform.ps1 -Platform douyin' }
            'wechat' { 'pwsh scripts\login-platform.ps1 -Platform wechat' }
            'kuaishou' { 'pwsh scripts\login-platform.ps1 -Platform kuaishou' }
          }
        }
        $alerts += [pscustomobject]@{
          platform = $r.k
          name = $r.n
          state = $state
          count = $count
          error = if ($st) { [string]$st.error } else { '' }
          fix = $fix
          at = (Get-Date -Format 'yyyy-MM-dd HH:mm')
        }
      }
    }
    Write-Log ('条数: ' + ($parts -join ' · ') + " · 观测 $($j.observedAt)")
    if ($alerts.Count) {
      $alerts | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $AlertPath -Encoding utf8
      foreach ($a in $alerts) { Write-Log ("!! $($a.name) 没数据（$($a.state)）→ 需重新登录：$($a.fix)") }
    } elseif (Test-Path -LiteralPath $AlertPath) {
      Remove-Item -LiteralPath $AlertPath -Force
    }

    $total = ($rows | ForEach-Object {
      $st = $j.status.($_.k)
      if ($st -and $null -ne $st.count) { [int]$st.count } else { @($j.($_.k).works).Count }
    } | Measure-Object -Sum).Sum
    if ($total -le 0) {
      $label = if ($Only) { $Only } else { '四平台' }
      throw "$label 全部 0 条，判定登录态失效，本次不提交"
    }
  }

  # ---------- 3. 提交并推送 ----------
  if ($DryRun) { Write-Log '[dry] 跳过 git 操作'; return }
  if ($NoPush) { Write-Log '指定了 -NoPush，只写本地不推送'; return }

  Push-Location $SiteRoot
  try {
    Invoke-Native $GitExe @('add', 'public/data/analytics.json') | Out-Null
    $pending = (Invoke-Native $GitExe @('status', '--porcelain', 'public/data/analytics.json') | Where-Object { $_ }) -join ''
    if (-not $pending) {
      Write-Log '数据无变化，无需提交'
      return
    }
    $stamp = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    $tag = if ($alerts.Count) { '（' + (($alerts | ForEach-Object { $_.name + ' 掉登录' }) -join '、') + '）' } else { '' }
    $msg = "data: 四平台数据快照 $stamp$tag"
    Invoke-Native $GitExe @('-c', 'user.name=analytics-bot', '-c', 'user.email=analytics-bot@local', 'commit', '-m', $msg) |
      ForEach-Object { Write-Log ('  ' + $_) }

    $pushed = $false
    for ($i = 1; $i -le 2; $i++) {
      $out = Invoke-Native $GitExe @('push', 'origin', 'main')
      $out | ForEach-Object { Write-Log ('  ' + $_) }
      if ($script:NativeExit -eq 0) { $pushed = $true; Write-Log "推送成功（直连，第 $i 次）"; break }
      Write-Log "直连推送失败（第 $i 次）"
      if ($i -lt 2) { Start-Sleep -Seconds 4 }
    }

    if (-not $pushed) {
      Write-Log '直连两次都没成，开代理再推'
      if (Start-ProxyIfNeeded) {
        for ($j = 1; $j -le 3; $j++) {
          $out = Invoke-Native $GitExe @('-c', "http.proxy=$Proxy", '-c', "https.proxy=$Proxy", 'push', 'origin', 'main')
          $out | ForEach-Object { Write-Log ('  ' + $_) }
          if ($script:NativeExit -eq 0) { $pushed = $true; Write-Log "推送成功（代理，第 $j 次）"; break }
          Write-Log "代理推送失败（第 $j 次）"
          if ($j -lt 3) { Start-Sleep -Seconds 6 }
        }
      }
    }

    if (-not $pushed) { throw '直连与代理都没推上去，数据已本地提交，下次运行会一起带上' }
  } finally { Pop-Location }

  Write-Log '本轮完成'
}
catch {
  Write-Log ('失败: ' + $_.Exception.Message)
  exit 1
}
finally {
  Stop-EdgeByProfile
}
