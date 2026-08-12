# serve.ps1 — tiny static file server for local development.
#
# The app is plain ES modules, so it needs to be served over http:// (opening
# index.html from the filesystem makes the browser refuse the imports). This
# needs nothing installed: it's raw .NET sockets via PowerShell.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1
#   then open http://localhost:5173
#
# Ctrl+C to stop.

param([int]$Port = 5173)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  '.html' = 'text/html; charset=utf-8'
  '.js'   = 'text/javascript; charset=utf-8'   # must be a JS type or modules are blocked
  '.css'  = 'text/css; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.webp' = 'image/webp'
  '.ico'  = 'image/x-icon'
  '.woff' = 'font/woff'
  '.woff2'= 'font/woff2'
}

# TcpListener rather than HttpListener: HttpListener prefixes need an admin
# URL reservation on Windows, a raw socket on loopback needs nothing.
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
try { $listener.Start() } catch { Write-Host "Could not listen on port $Port : $($_.Exception.Message)"; exit 1 }

Write-Host "Serving $root"
Write-Host "  -> http://localhost:$Port"
Write-Host "Press Ctrl+C to stop."

function Send-Response($stream, [int]$code, [string]$status, [string]$type, [byte[]]$body) {
  $head = "HTTP/1.1 $code $status`r`n" +
          "Content-Type: $type`r`n" +
          "Content-Length: $($body.Length)`r`n" +
          "Cache-Control: no-store`r`n" +   # always serve the file as it is on disk
          "Connection: close`r`n`r`n"
  $hb = [System.Text.Encoding]::ASCII.GetBytes($head)
  $stream.Write($hb, 0, $hb.Length)
  if ($body.Length) { $stream.Write($body, 0, $body.Length) }
  $stream.Flush()
}

while ($true) {
  $client = $listener.AcceptTcpClient()
  try {
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::ASCII)
    $line = $reader.ReadLine()
    if (-not $line) { $client.Close(); continue }

    $parts = $line -split ' '
    $rawPath = if ($parts.Length -ge 2) { $parts[1] } else { '/' }
    $path = ($rawPath -split '\?')[0]
    try { $path = [System.Uri]::UnescapeDataString($path) } catch {}
    if ($path -eq '/' -or $path.EndsWith('/')) { $path = $path + 'index.html' }

    # Resolve inside the served folder only — no climbing out with "..".
    $rel = $path.TrimStart('/') -replace '/', '\'
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    $inside = $full.StartsWith(([System.IO.Path]::GetFullPath($root) + '\'), [StringComparison]::OrdinalIgnoreCase)

    if ($inside -and (Test-Path -LiteralPath $full -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($full).ToLower()
      $type = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $bytes = [System.IO.File]::ReadAllBytes($full)
      Send-Response $stream 200 'OK' $type $bytes
      Write-Host "200 $path"
    } else {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found: $path")
      Send-Response $stream 404 'Not Found' 'text/plain; charset=utf-8' $bytes
      Write-Host "404 $path"
    }
  } catch {
    Write-Host "error: $($_.Exception.Message)"
  } finally {
    try { $client.Close() } catch {}
  }
}
