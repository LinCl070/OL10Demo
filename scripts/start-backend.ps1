<#
.SYNOPSIS
  一键启动 Atlas GIS 后端（Spring Boot + PostgreSQL/PostGIS）。
.DESCRIPTION
  依次完成：检查后端是否已在运行 → 查找 JDK 17+ → 确认 PostgreSQL 已启动 →
  获取并校验数据库密码 → 数据库不存在时自动创建 → 检查 PostGIS → mvnw spring-boot:run。
  使用方式：双击项目根目录的 start-backend.cmd，或在终端运行 npm run backend。
.PARAMETER ResetPassword
  忽略已保存的密码和 ATLAS_DB_PASSWORD 环境变量，重新输入。
.PARAMETER JavaHome
  手动指定 JDK 目录（默认自动查找版本最高的 JDK 17+）。
.PARAMETER PauseOnError
  出错后等待按键再退出，避免双击运行时窗口一闪而过（start-backend.cmd 会自动加上）。
#>
[CmdletBinding()]
param(
  [switch]$ResetPassword,
  [string]$JavaHome,
  [switch]$PauseOnError
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$serverDir = Join-Path $repoRoot 'server'
# Spring Boot 启动时会自动读取工作目录下的 config/application.properties；该目录已被 server/.gitignore 忽略。
$localConfig = Join-Path $serverDir 'config\application.properties'

# 默认值与 server/src/main/resources/application.properties 保持一致。
$dbUrl = if ($env:ATLAS_DB_URL) { $env:ATLAS_DB_URL } else { 'jdbc:postgresql://localhost:5432/atlas_gis' }
$dbUser = if ($env:ATLAS_DB_USER) { $env:ATLAS_DB_USER } else { 'postgres' }
$serverPort = if ($env:ATLAS_SERVER_PORT) { [int]$env:ATLAS_SERVER_PORT } else { 8081 }

function Write-Step([string]$Text) { Write-Host "==> $Text" -ForegroundColor Cyan }
function Write-Info([string]$Text) { Write-Host "    $Text" }
function Write-Ok([string]$Text) { Write-Host "    $Text" -ForegroundColor Green }
function Stop-WithError([string]$Text) {
  Write-Host "[错误] $Text" -ForegroundColor Red
  if ($PauseOnError) {
    Write-Host ''
    Read-Host '后端启动失败，按回车键关闭窗口' | Out-Null
  }
  exit 1
}

# ---------- JDK ----------

# 从 JDK 根目录的 release 文件读取主版本号；不是有效 JDK 时返回 0。
function Get-JdkMajorVersion([string]$JdkHome) {
  if (-not $JdkHome -or -not (Test-Path (Join-Path $JdkHome 'bin\java.exe'))) { return 0 }
  $release = Join-Path $JdkHome 'release'
  if (-not (Test-Path $release)) { return 0 }
  $match = Select-String -Path $release -Pattern '^JAVA_VERSION="([^"]+)"' | Select-Object -First 1
  if (-not $match) { return 0 }
  $parts = $match.Matches[0].Groups[1].Value.Split('.')
  # Java 8 及更早的版本号形如 1.8.0_504
  $major = if ($parts[0] -eq '1' -and $parts.Count -gt 1) { $parts[1] } else { $parts[0] }
  return [int]($major -replace '\D', '')
}

# 优先级：-JavaHome 参数 > 满足要求的 JAVA_HOME > 常见安装目录中版本最高的 JDK 17+。
function Find-Jdk {
  if ($JavaHome) {
    $version = Get-JdkMajorVersion $JavaHome
    if ($version -lt 17) { Stop-WithError "-JavaHome 指定的目录不是 JDK 17+：$JavaHome" }
    return @{ Home = $JavaHome; Version = $version }
  }
  $envVersion = Get-JdkMajorVersion $env:JAVA_HOME
  if ($envVersion -ge 17) { return @{ Home = $env:JAVA_HOME; Version = $envVersion } }

  $candidates = New-Object System.Collections.Generic.List[string]
  foreach ($command in @(Get-Command java.exe -All -ErrorAction SilentlyContinue)) {
    $candidates.Add((Split-Path -Parent (Split-Path -Parent $command.Source)))
  }
  foreach ($root in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, 'D:\Program Files') | Where-Object { $_ }) {
    foreach ($vendor in 'Java', 'Eclipse Adoptium', 'Microsoft', 'Zulu', 'Amazon Corretto', 'BellSoft') {
      $vendorDir = Join-Path $root $vendor
      if (Test-Path $vendorDir) {
        Get-ChildItem -Path $vendorDir -Directory | ForEach-Object { $candidates.Add($_.FullName) }
      }
    }
  }
  $best = $null
  foreach ($candidate in $candidates | Select-Object -Unique) {
    $version = Get-JdkMajorVersion $candidate
    if ($version -ge 17 -and ($null -eq $best -or $version -gt $best.Version)) {
      $best = @{ Home = $candidate; Version = $version }
    }
  }
  if ($null -eq $best) { Stop-WithError '未找到 JDK 17 或更高版本。请安装 JDK（推荐 25），或用 -JavaHome 指定目录。' }
  return $best
}

# ---------- 网络与 PostgreSQL ----------

function Test-TcpPort([string]$HostName, [int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    return ($async.AsyncWaitHandle.WaitOne(1500) -and $client.Connected)
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Test-BackendHealthy {
  try {
    $health = Invoke-RestMethod -Uri "http://127.0.0.1:$serverPort/api/health" -TimeoutSec 3
    return $health.status -eq 'ok'
  } catch {
    return $false
  }
}

# 把 jdbc:postgresql://host:port/db 拆成 psql 需要的参数。
function Get-DbTarget([string]$JdbcUrl) {
  if ($JdbcUrl -notmatch '^jdbc:postgresql://([^:/?]+)(?::(\d+))?/([^?]+)') {
    Stop-WithError "无法解析数据库地址：$JdbcUrl"
  }
  $port = if ($Matches[2]) { [int]$Matches[2] } else { 5432 }
  return @{ Host = $Matches[1]; Port = $port; Database = $Matches[3] }
}

function Find-Psql {
  $command = Get-Command psql.exe -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  # 未加入 PATH 时，从 PostgreSQL Windows 服务的安装路径推断 bin 目录。
  foreach ($service in @(Get-CimInstance -ClassName Win32_Service | Where-Object { $_.Name -like 'postgresql*' })) {
    if ($service.PathName -match '"?([^"]+?\\bin)\\pg_ctl\.exe') {
      $psql = Join-Path $Matches[1] 'psql.exe'
      if (Test-Path $psql) { return $psql }
    }
  }
  return $null
}

# 本机数据库未启动时尝试启动 Windows 服务（需要管理员权限，失败时给出手动操作提示）。
function Start-LocalPostgres([hashtable]$Target) {
  if (Test-TcpPort $Target.Host $Target.Port) { return }
  $isLocal = $Target.Host -in 'localhost', '127.0.0.1', '::1'
  $services = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)
  if (-not $isLocal -or $services.Count -eq 0) {
    Stop-WithError "无法连接数据库 $($Target.Host):$($Target.Port)，请先启动 PostgreSQL。"
  }
  foreach ($service in $services | Where-Object Status -ne 'Running') {
    Write-Info "正在启动服务 $($service.Name) ..."
    try {
      Start-Service -Name $service.Name
    } catch {
      Stop-WithError "启动 $($service.Name) 失败（可能需要管理员权限）。请以管理员身份运行，或在“服务”中手动启动。"
    }
  }
  for ($i = 0; $i -lt 20 -and -not (Test-TcpPort $Target.Host $Target.Port); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-TcpPort $Target.Host $Target.Port)) {
    Stop-WithError "PostgreSQL 服务已启动，但端口 $($Target.Port) 仍无法连接。"
  }
}

# 用 psql 执行一条查询，返回 { Code; Output }。密码通过 PGPASSWORD 传给子进程，不出现在命令行参数里。
function Invoke-Psql([string]$Psql, [hashtable]$Target, [string]$Database, [string]$Password, [string]$Sql) {
  $previous = $env:PGPASSWORD
  $env:PGPASSWORD = $Password
  try {
    $output = & $Psql -h $Target.Host -p $Target.Port -U $dbUser -d $Database -w -X -tAq -v ON_ERROR_STOP=1 -c $Sql 2>&1
    return @{ Code = $LASTEXITCODE; Output = (($output | ForEach-Object { "$_" }) -join "`n").Trim() }
  } finally {
    $env:PGPASSWORD = $previous
  }
}

# ---------- 数据库密码 ----------

# .properties 中反斜杠是转义符，读写时需要成对处理。
function ConvertTo-PropertyValue([string]$Value) { return $Value.Replace('\', '\\') }
function ConvertFrom-PropertyValue([string]$Value) { return $Value.Replace('\\', '\') }

function Read-SavedPassword {
  if (-not (Test-Path $localConfig)) { return $null }
  $line = Get-Content -Path $localConfig -Encoding UTF8 | Where-Object { $_ -match '^\s*spring\.datasource\.password\s*=' } | Select-Object -First 1
  if (-not $line) { return $null }
  return ConvertFrom-PropertyValue (($line -split '=', 2)[1].Trim())
}

# 只更新密码这一行，保留文件中的其他自定义配置。
function Save-Password([string]$Password) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $localConfig) | Out-Null
  $lines = if (Test-Path $localConfig) {
    @(Get-Content -Path $localConfig -Encoding UTF8 | Where-Object { $_ -notmatch '^\s*spring\.datasource\.password\s*=' })
  } else {
    @('# 本地数据库配置，由 scripts/start-backend.ps1 生成；该目录已被 git 忽略，请勿提交。')
  }
  $lines += "spring.datasource.password=$(ConvertTo-PropertyValue $Password)"
  # 不带 BOM 的 UTF-8，避免 Spring 把 BOM 当作属性名的一部分。
  [System.IO.File]::WriteAllLines($localConfig, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))
}

function Read-PasswordFromConsole {
  # 非交互环境（如被其他程序调用、输入被重定向）无法弹出密码输入。
  if ([Console]::IsInputRedirected) {
    Stop-WithError '当前不是交互式终端，无法输入密码。请设置环境变量 ATLAS_DB_PASSWORD，或先在终端中运行一次本脚本保存密码。'
  }
  $secure = Read-Host -Prompt "    请输入 PostgreSQL 用户 $dbUser 的密码" -AsSecureString
  $pointer = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    return [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

# 依次尝试环境变量、已保存的密码，都不可用时交互输入（最多 3 次）。连接 postgres 库校验，因为业务库可能尚未创建。
function Resolve-Password([string]$Psql, [hashtable]$Target) {
  $candidates = @()
  if (-not $ResetPassword) {
    if ($env:ATLAS_DB_PASSWORD) { $candidates += @{ Value = $env:ATLAS_DB_PASSWORD; Source = '环境变量' } }
    $saved = Read-SavedPassword
    if ($saved) { $candidates += @{ Value = $saved; Source = '已保存' } }
  }
  foreach ($candidate in $candidates) {
    $result = Invoke-Psql $Psql $Target 'postgres' $candidate.Value 'SELECT 1'
    if ($result.Code -eq 0) {
      Write-Ok "使用$($candidate.Source)的密码登录成功"
      return @{ Value = $candidate.Value; Prompted = $false }
    }
    Write-Info "$($candidate.Source)的密码无法登录，需要重新输入。"
  }
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $password = Read-PasswordFromConsole
    $result = Invoke-Psql $Psql $Target 'postgres' $password 'SELECT 1'
    if ($result.Code -eq 0) {
      Write-Ok '登录成功'
      return @{ Value = $password; Prompted = $true }
    }
    if ($result.Output -notmatch 'password|密码|authentication|认证') {
      Stop-WithError "无法连接数据库：$($result.Output)"
    }
    Write-Host "    密码错误（$attempt/3）" -ForegroundColor Yellow
  }
  Stop-WithError '密码错误次数过多，已退出。'
}

# ---------- 主流程 ----------

Write-Host ''
Write-Host 'Atlas GIS 后端一键启动' -ForegroundColor White
Write-Host ''

Write-Step "检查端口 $serverPort"
if (Test-BackendHealthy) {
  Write-Ok "后端已在运行：http://127.0.0.1:$serverPort/api/health"
  exit 0
}
if (Test-TcpPort '127.0.0.1' $serverPort) {
  Stop-WithError "端口 $serverPort 已被其他程序占用。可设置环境变量 ATLAS_SERVER_PORT 换端口（同时修改 vite.config.js 中的代理地址）。"
}
Write-Ok '端口可用'

Write-Step '查找 JDK'
$jdk = Find-Jdk
$env:JAVA_HOME = $jdk.Home
Write-Ok "JDK $($jdk.Version)：$($jdk.Home)"

Write-Step '检查 PostgreSQL'
$target = Get-DbTarget $dbUrl
Start-LocalPostgres $target
Write-Ok "数据库服务可连接：$($target.Host):$($target.Port)"
$psql = Find-Psql
if (-not $psql) { Stop-WithError '未找到 psql.exe。请把 PostgreSQL 的 bin 目录加入 PATH。' }

Write-Step '验证数据库账号'
$password = Resolve-Password $psql $target
if ($password.Prompted) {
  $answer = Read-Host '    是否保存密码到 server\config\application.properties，下次免输入？(Y/n)'
  if ($answer -notmatch '^[nN]') {
    Save-Password $password.Value
    Write-Ok '已保存（该文件已被 git 忽略，不会被提交）'
  }
}

Write-Step "准备数据库 $($target.Database)"
# 数据库名来自配置，只允许字母、数字和下划线，避免拼进 SQL 时出问题。
if ($target.Database -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') { Stop-WithError "数据库名不合法：$($target.Database)" }
$exists = Invoke-Psql $psql $target 'postgres' $password.Value "SELECT 1 FROM pg_database WHERE datname = '$($target.Database)'"
if ($exists.Code -ne 0) { Stop-WithError "查询数据库失败：$($exists.Output)" }
if ($exists.Output -ne '1') {
  $created = Invoke-Psql $psql $target 'postgres' $password.Value "CREATE DATABASE $($target.Database) ENCODING 'UTF8' TEMPLATE template0"
  if ($created.Code -ne 0) { Stop-WithError "创建数据库失败：$($created.Output)" }
  Write-Ok "已创建数据库 $($target.Database)"
} else {
  Write-Ok '数据库已存在'
}
$postgis = Invoke-Psql $psql $target $target.Database $password.Value "SELECT default_version FROM pg_available_extensions WHERE name = 'postgis'"
if ($postgis.Code -ne 0 -or -not $postgis.Output) {
  Stop-WithError 'PostgreSQL 未安装 PostGIS 扩展。请通过 Stack Builder 安装 PostGIS 后重试。'
}
Write-Ok "PostGIS $($postgis.Output) 可用（表结构由后端启动时自动创建）"

Write-Step '启动 Spring Boot（首次运行需下载依赖，可能要几分钟；按 Ctrl+C 停止）'
Write-Info "健康检查：http://127.0.0.1:$serverPort/api/health"
Write-Info '前端：在项目根目录另开终端执行 npm run dev'
Write-Host ''
# 密码通过环境变量只传给本次启动的后端进程，不写入命令行参数。
$env:ATLAS_DB_PASSWORD = $password.Value
Push-Location $serverDir
try {
  & (Join-Path $serverDir 'mvnw.cmd') -B spring-boot:run
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
}
exit $exitCode
