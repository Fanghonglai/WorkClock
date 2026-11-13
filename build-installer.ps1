# 构建 工时打卡 安装程序：重新打包 app.asar → 压缩程序文件 → 编译卸载程序与安装程序
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$out = Join-Path $root 'dist'
$obj = Join-Path $root 'obj'
New-Item -ItemType Directory -Force $out, $obj | Out-Null

Write-Host '1/5 打包 app.asar'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'asar.ps1') pack (Join-Path $root 'win-unpacked\resources\app.asar') (Join-Path $root 'app')
Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $root 'win-unpacked\workclock.config.json')

Write-Host '2/5 压缩程序文件'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = Join-Path $obj 'payload.zip'
Remove-Item -Force -ErrorAction SilentlyContinue $zip
[IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $root 'win-unpacked'), $zip, [IO.Compression.CompressionLevel]::Optimal, $false)

Write-Host '3/5 生成图标'
$png = [IO.File]::ReadAllBytes((Join-Path $root 'app\build\icon.png'))
$ms = New-Object IO.MemoryStream
$w = New-Object IO.BinaryWriter($ms)
$w.Write([uint16]0); $w.Write([uint16]1); $w.Write([uint16]1)
$w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0); $w.Write([byte]0)
$w.Write([uint16]1); $w.Write([uint16]32); $w.Write([uint32]$png.Length); $w.Write([uint32]22)
$w.Write($png); $w.Flush()
$ico = Join-Path $obj 'icon.ico'
[IO.File]::WriteAllBytes($ico, $ms.ToArray())

$common = @('/nologo', '/codepage:65001', '/optimize+', '/target:winexe', '/platform:anycpu',
  "/win32icon:$ico", "/win32manifest:$(Join-Path $root 'installer\app.manifest')",
  '/r:System.dll', '/r:System.Drawing.dll', '/r:System.Windows.Forms.dll')

Write-Host '4/5 编译卸载程序'
$uninst = Join-Path $obj 'Uninstall.exe'
& $csc @common "/out:$uninst" (Join-Path $root 'installer\Common.cs') (Join-Path $root 'installer\Uninstall.cs')
if ($LASTEXITCODE -ne 0) { throw 'Uninstall 编译失败' }

Write-Host '5/5 编译安装程序'
$setup = Join-Path $out 'WorkClock-1.1.1-Setup.exe'
& $csc @common "/out:$setup" '/r:System.IO.Compression.dll' '/r:System.IO.Compression.FileSystem.dll' `
  "/resource:$zip,payload.zip" "/resource:$uninst,uninstall.exe" `
  (Join-Path $root 'installer\Common.cs') (Join-Path $root 'installer\Setup.cs')
if ($LASTEXITCODE -ne 0) { throw 'Setup 编译失败' }

Write-Host '生成绿色便携版 zip 包'
$portableZip = Join-Path $out 'WorkClock-1.1.1-win-x64.zip'
Remove-Item -Force -ErrorAction SilentlyContinue $portableZip
Copy-Item $zip $portableZip -Force

Write-Host ("完成：{0} ({1:N1} MB)" -f $setup, ((Get-Item $setup).Length / 1MB))
Write-Host ("完成：{0} ({1:N1} MB)" -f $portableZip, ((Get-Item $portableZip).Length / 1MB))
