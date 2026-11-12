param([string]$Mode, [string]$Asar, [string]$Dir)
# Minimal asar extract/pack in PowerShell
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Extract {
  $bytes = [IO.File]::ReadAllBytes($Asar)
  $headerPickleSize = [BitConverter]::ToUInt32($bytes, 4)
  $jsonLen = [BitConverter]::ToInt32($bytes, 12)
  $json = $utf8.GetString($bytes, 16, $jsonLen)
  $base = 8 + $headerPickleSize
  [IO.File]::WriteAllText((Join-Path $Dir '..\asar-header.json'), $json, $utf8)
  $hdr = $json | ConvertFrom-Json
  function Walk($node, $path) {
    foreach ($p in $node.files.PSObject.Properties) {
      $child = $p.Value; $cp = Join-Path $path $p.Name
      if ($child.files) { New-Item -ItemType Directory -Force $cp | Out-Null; Walk $child $cp }
      elseif ($child.unpacked) { Write-Host "UNPACKED: $cp" }
      elseif ($null -ne $child.offset) {
        $off = [int64]$child.offset + $base; $size = [int]$child.size
        $buf = New-Object byte[] $size
        [Array]::Copy($bytes, $off, $buf, 0, $size)
        New-Item -ItemType Directory -Force (Split-Path $cp) | Out-Null
        [IO.File]::WriteAllBytes($cp, $buf)
      }
    }
  }
  New-Item -ItemType Directory -Force $Dir | Out-Null
  Walk $hdr $Dir
}

function Pack {
  $ms = New-Object IO.MemoryStream
  $script:offset = [int64]0
  function Build($path) {
    $files = [ordered]@{}
    foreach ($item in Get-ChildItem -LiteralPath $path -Force | Sort-Object Name) {
      if ($item.PSIsContainer) { $files[$item.Name] = [ordered]@{ files = (Build $item.FullName) } }
      else {
        $data = [IO.File]::ReadAllBytes($item.FullName)
        $ms.Write($data, 0, $data.Length)
        $sha = [Security.Cryptography.SHA256]::Create()
        $hash = -join ($sha.ComputeHash($data) | ForEach-Object { $_.ToString('x2') })
        $blockSize = 4194304; $blocks = @()
        for ($i = 0; $i -lt $data.Length; $i += $blockSize) {
          $n = [Math]::Min($blockSize, $data.Length - $i)
          $blocks += -join ($sha.ComputeHash($data, $i, $n) | ForEach-Object { $_.ToString('x2') })
        }
        if ($blocks.Count -eq 0) { $blocks = @(-join ($sha.ComputeHash([byte[]]@()) | ForEach-Object { $_.ToString('x2') })) }
        $files[$item.Name] = [ordered]@{ size = $data.Length; offset = "$($script:offset)"; integrity = [ordered]@{ algorithm = 'SHA256'; hash = $hash; blockSize = $blockSize; blocks = $blocks } }
        $script:offset += $data.Length
      }
    }
    return $files
  }
  $tree = [ordered]@{ files = (Build (Resolve-Path $Dir).Path) }
  $json = $tree | ConvertTo-Json -Depth 100 -Compress
  $jb = $utf8.GetBytes($json)
  $jsonLen = $jb.Length
  $pad = (4 - ($jsonLen % 4)) % 4
  $payloadSize = 4 + $jsonLen + $pad          # inner pickle payload: string len + string + pad
  $headerPickleSize = 4 + $payloadSize        # pickle = payload size field + payload
  $out = New-Object IO.MemoryStream
  $w = New-Object IO.BinaryWriter($out)
  $w.Write([uint32]4); $w.Write([uint32]$headerPickleSize)
  $w.Write([uint32]$payloadSize); $w.Write([int32]$jsonLen); $w.Write($jb); $w.Write((New-Object byte[] $pad))
  $w.Write($ms.ToArray()); $w.Flush()
  [IO.File]::WriteAllBytes($Asar, $out.ToArray())
}

if ($Mode -eq 'extract') { Extract } else { Pack }
