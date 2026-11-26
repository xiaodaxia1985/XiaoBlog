<#
.SYNOPSIS
  四平台数据每日自动抓取 → 写入 site 快照 → 推送 GitHub → 触发服务器部署/入库。

.DESCRIPTION
  由 Windows 任务计划程序在 09:00 / 22:00 调用。流程：
    1. 探活专用 Edge 调试端口（9224）；不在线则用持久化 profile 无头拉起，跑完关掉
    2. node scripts/collect-analytics.mjs 抓四平台 → public/data/analytics.json
    3. 校验 JSON（四平台至少要有一条数据，否则视为登录态失效，不提交）
    4. git commit + push（先试系统代理 7897，失败再直连）
  日志固定写 .tmp\analytics-collect.log（项目内，不落 C 盘）。

.EXAMPLE
  pwsh -ExecutionPolicy Bypass -File scripts\daily-collect.ps1
#>
param(
  [int]$Port = 9224,
  [string]$Proxy = 'http://127.0.0.1:7897',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# 外部程序（git/node）吐的是 UTF-8，而默认控制台编码是 GBK，不统一会让日志和
# commit message 全变乱码。
$OutputEncoding = New-Object System.Text.UTF8Encoding($false)
try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

$SiteRoot = Split-Path -Parent $PSScriptRoot          # ...\site\XiaoBlog
$ProjRoot = Split-Path -Parent (Split-Path -Parent $SiteRoot)  # ...\个人商业实战
$LogPath  = Join-Path $ProjRoot '.tmp\analytics-collect.log'
$Profile_ = Join-Path $ProjRoot '.tmp\edge-profile'
$NodeExe  = 'C:\Program Files\nodejs\node.exe'
$EdgeExe  = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
$GitExe   = 'C:\Program Files\Git\cmd\git.exe'
$JsonPath = Join-Path $SiteRoot 'public\data\analytics.json'

New-Item -ItemType Directory -Path (Split-Path $LogPath) -Force | Out-Null

function Write-Log([string]$Msg) {
  $line = '[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $Msg
  Add-Content -LiteralPath $LogPath -Value $line -Encoding utf8
  Write-Host $line
}

# 调用外部程序：合并 stderr、不让 git 的正常进度输出（PowerShell 5.1 会把它包成
# NativeCommandError）在 $ErrorActionPreference='Stop' 下被当成异常抛出。
# 返回输出行，退出码放在 $script:NativeExit。
function Invoke-Native([string]$Exe, [string[]]$ArgList) {
  $ErrorActionPreference = 'Continue'
  $out = & $Exe @ArgList 2>&1
  $script:NativeExit = $LASTEXITCODE
  return @($out | ForEach-Object { $_.ToString() })
}

function Test-Cdp {
  try { $null = Invoke-RestMethod "http://127.0.0.1:$Port/json/version" -TimeoutSec 4; return $true }
  catch { return $false }
}

# ---------- 代理 ----------
$ClashExe = 'C:\Program Files\Clash Verge\clash-verge.exe'

function Test-ProxyPort {
  try {
    $c = New-Object System.Net.Sockets.TcpClient
    $c.Connect('127.0.0.1', 7897)
    $c.Close()
    return $true
  } catch { return $false }
}

# push 连不上时把 Clash Verge 拉起来（它会自动恢复 7897 端口）。
# 已在运行就不再重复启动，也不去动它的节点选择。
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

$startedEdge = $null
try {
  # ---------- 1. 调试端口 ----------
  if ($DryRun) { Write-Log '[dry] 跳过 CDP 检活' }
  elseif (Test-Cdp) { Write-Log "CDP $Port 在线" }
  else {
    Write-Log "CDP $Port 不在线，用持久化 profile 无头拉起"
    if (-not (Test-Path -LiteralPath $EdgeExe)) { throw "找不到 Edge: $EdgeExe" }
    if (-not (Test-Path -LiteralPath $Profile_)) { throw "找不到登录态 profile: $Profile_（需先手动扫码登录一次）" }
    $startedEdge = Start-Process -FilePath $EdgeExe -WindowStyle Hidden -PassThru -ArgumentList @(
      '--headless=new',
      "--remote-debugging-port=$Port",
      "--user-data-dir=`"$Profile_`"",
      '--no-first-run', '--no-default-browser-check', '--disable-gpu',
      'about:blank'
    )
    $ok = $false
    for ($i = 0; $i -lt 20; $i++) { Start-Sleep -Seconds 1; if (Test-Cdp) { $ok = $true; break } }
    if (-not $ok) { throw "无头 Edge 启动后 CDP $Port 仍未就绪" }
    Write-Log '无头 Edge 已就绪'
  }

  # ---------- 2. 抓数 ----------
  if (-not (Test-Path -LiteralPath $NodeExe)) {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if (-not $cmd) { throw '找不到 node.exe' }
    $NodeExe = $cmd.Source
  }
  if ($DryRun) {
    Write-Log ('[dry] node scripts/collect-analytics.mjs --port ' + $Port)
  } else {
    Push-Location $SiteRoot
    try {
      Write-Log '开始抓取四平台…'
      $raw = & $NodeExe 'scripts\collect-analytics.mjs' '--port' $Port '--out' 'public\data\analytics.json' 2>&1
      $raw | ForEach-Object { Write-Log ('  ' + $_) }
      if ($LASTEXITCODE -ne 0) { throw "采集脚本退出码 $LASTEXITCODE" }
    } finally { Pop-Location }
  }

  # ---------- 3. 校验 ----------
  if (-not $DryRun) {
    if (-not (Test-Path -LiteralPath $JsonPath)) { throw "没有生成 $JsonPath" }
    $j = Get-Content -LiteralPath $JsonPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $counts = @(
      [pscustomobject]@{ n = '抖音'; v = @($j.douyin.works).Count },
      [pscustomobject]@{ n = '微信'; v = @($j.wechat.works).Count },
      [pscustomobject]@{ n = '快手'; v = @($j.kuaishou.works).Count },
      [pscustomobject]@{ n = '小红书'; v = @($j.xiaohongshu.works).Count }
    )
    Write-Log ('条数: ' + (($counts | ForEach-Object { "$($_.n) $($_.v)" }) -join ' · ') + " · 观测 $($j.observedAt)")
    $total = ($counts | Measure-Object -Property v -Sum).Sum
    if ($total -le 0) {
      throw '四平台全部 0 条，判定登录态失效，本次不提交（请在 9224 实例里重新扫码）'
    }
  }

  # ---------- 4. 提交并推送 ----------
  if ($DryRun) { Write-Log '[dry] 跳过 git 操作'; return }
  Push-Location $SiteRoot
  try {
    Invoke-Native $GitExe @('add', 'public/data/analytics.json') | Out-Null
    $pending = (Invoke-Native $GitExe @('status', '--porcelain', 'public/data/analytics.json') | Where-Object { $_ }) -join ''
    if (-not $pending) {
      Write-Log '数据无变化，无需提交'
      return
    }
    $stamp = (Get-Date -Format 'yyyy-MM-dd HH:mm')
    $msg = 'data: 四平台数据快照 ' + $stamp
    Invoke-Native $GitExe @('-c', 'user.name=analytics-bot', '-c', 'user.email=analytics-bot@local', 'commit', '-m', $msg) |
      ForEach-Object { Write-Log ('  ' + $_) }

    $pushed = $false
    # 直连先试 2 次；两次都不成就开代理（Clash Verge），代理下再试 3 次。
    # 家宽到 GitHub 会间歇性 reset / Empty reply，但连着 2 次失败基本就是链路被掐，
    # 干等没用，直接把代理拉起来。
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
  if ($startedEdge -and -not $startedEdge.HasExited) {
    try { Stop-Process -Id $startedEdge.Id -Force -ErrorAction SilentlyContinue } catch {}
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -like "*$Profile_*" } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Log '已关闭本次拉起的无头 Edge'
  }
}
