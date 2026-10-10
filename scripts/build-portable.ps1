param(
  [string]$NodeExecutable = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = [System.IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "release"))
$packageDirectory = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "package-staging\Grile Diana"))
$archivePath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "GRILE DIA.zip"))
$checksumPath = [System.IO.Path]::GetFullPath((Join-Path $releaseRoot "GRILE DIA.sha256.txt"))
$sendArchivePath = [System.IO.Path]::GetFullPath((Join-Path $projectRoot "GRILE DIA.zip"))

function Assert-InReleaseDirectory([string]$PathToCheck) {
  $resolved = [System.IO.Path]::GetFullPath($PathToCheck)
  $prefix = $releaseRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
  if (-not $resolved.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Calea de build iese din directorul release: $resolved"
  }
}

Assert-InReleaseDirectory $packageDirectory
Assert-InReleaseDirectory $archivePath
Assert-InReleaseDirectory $checksumPath

if ([string]::IsNullOrWhiteSpace($NodeExecutable)) {
  $nodeCommand = Get-Command node.exe -ErrorAction Stop
  $NodeExecutable = $nodeCommand.Source
}
$NodeExecutable = [System.IO.Path]::GetFullPath($NodeExecutable)
if (-not (Test-Path -LiteralPath $NodeExecutable -PathType Leaf)) {
  throw "Nu a fost găsit node.exe la $NodeExecutable"
}

$nodeDirectory = Split-Path -Parent $NodeExecutable
$nodeLicense = Join-Path $nodeDirectory "LICENSE"
if (-not (Test-Path -LiteralPath $nodeLicense -PathType Leaf)) {
  throw "Licența runtime-ului Node.js lipsește din $nodeDirectory"
}

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
if (Test-Path -LiteralPath $packageDirectory) {
  Remove-Item -LiteralPath $packageDirectory -Recurse -Force
}
if (Test-Path -LiteralPath $archivePath) {
  Remove-Item -LiteralPath $archivePath -Force
}
if (Test-Path -LiteralPath $checksumPath) {
  Remove-Item -LiteralPath $checksumPath -Force
}

New-Item -ItemType Directory -Path $packageDirectory -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDirectory "assets") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDirectory "data") -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $packageDirectory "runtime") -Force | Out-Null

$applicationFiles = @(
  "index.html",
  "selectare.html",
  "selectare.css",
  "selectare.js",
  "quizz.html",
  "quiz.css",
  "quiz.js",
  "profil.html",
  "profile.css",
  "profile.js",
  "flashcards.html",
  "flashcards.css",
  "flashcards.js",
  "materiale.html",
  "materiale.css",
  "materiale.js",
  "file-store.js",
  "app-core.js",
  "server.js",
  "PORNIRE.txt"
)

foreach ($relativePath in $applicationFiles) {
  Copy-Item -LiteralPath (Join-Path $projectRoot $relativePath) -Destination (Join-Path $packageDirectory $relativePath)
}

Copy-Item -LiteralPath (Join-Path $projectRoot "assets\grile-diana-icon.png") -Destination (Join-Path $packageDirectory "assets\grile-diana-icon.png")
Copy-Item -LiteralPath (Join-Path $projectRoot "data\question-bank.js") -Destination (Join-Path $packageDirectory "data\question-bank.js")
Copy-Item -LiteralPath (Join-Path $projectRoot "data\flashcard-bank.js") -Destination (Join-Path $packageDirectory "data\flashcard-bank.js")
Copy-Item -LiteralPath (Join-Path $projectRoot "data\notes-bank.js") -Destination (Join-Path $packageDirectory "data\notes-bank.js")
Copy-Item -LiteralPath $NodeExecutable -Destination (Join-Path $packageDirectory "runtime\node.exe")
Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $packageDirectory "runtime\NODE-LICENSE.txt")

function Convert-PngToMultiSizeIcon([string]$SourcePng, [string]$DestinationIco) {
  Add-Type -AssemblyName System.Drawing
  $sizes = @(16, 24, 32, 48, 64, 128, 256)
  $sourceImage = [System.Drawing.Image]::FromFile($SourcePng)
  $iconImages = New-Object System.Collections.Generic.List[byte[]]

  try {
    foreach ($size in $sizes) {
      $bitmap = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $stream = New-Object System.IO.MemoryStream
      try {
        $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        $iconImages.Add($stream.ToArray())
      }
      finally {
        $stream.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
      }
    }
  }
  finally {
    $sourceImage.Dispose()
  }

  $fileStream = [System.IO.File]::Open($DestinationIco, [System.IO.FileMode]::Create)
  $writer = New-Object System.IO.BinaryWriter($fileStream)
  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$sizes.Count)

    $offset = 6 + (16 * $sizes.Count)
    for ($index = 0; $index -lt $sizes.Count; $index++) {
      $size = $sizes[$index]
      $imageBytes = $iconImages[$index]
      $writer.Write([Byte]$(if ($size -eq 256) { 0 } else { $size }))
      $writer.Write([Byte]$(if ($size -eq 256) { 0 } else { $size }))
      $writer.Write([Byte]0)
      $writer.Write([Byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$imageBytes.Length)
      $writer.Write([UInt32]$offset)
      $offset += $imageBytes.Length
    }

    foreach ($imageBytes in $iconImages) {
      $writer.Write($imageBytes)
    }
  }
  finally {
    $writer.Dispose()
    $fileStream.Dispose()
  }
}

$iconPath = Join-Path $packageDirectory "assets\grile-diana.ico"
Convert-PngToMultiSizeIcon -SourcePng (Join-Path $projectRoot "assets\grile-diana-icon.png") -DestinationIco $iconPath

$compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  $compiler = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
  throw "Compilatorul C# .NET Framework nu a fost găsit."
}

$launcherSource = Join-Path $projectRoot "launcher\GrileDianaLauncher.cs"
$launcherManifest = Join-Path $projectRoot "launcher\app.manifest"
$launcherExecutable = Join-Path $packageDirectory "Grile Diana.exe"
$compilerArguments = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/platform:anycpu",
  "/win32icon:$iconPath",
  "/win32manifest:$launcherManifest",
  "/out:$launcherExecutable",
  "/reference:System.dll",
  "/reference:System.Core.dll",
  "/reference:System.Drawing.dll",
  "/reference:System.Windows.Forms.dll",
  $launcherSource
)

& $compiler @compilerArguments
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $launcherExecutable -PathType Leaf)) {
  throw "Compilarea launcherului a eșuat."
}

Compress-Archive -LiteralPath $packageDirectory -DestinationPath $archivePath -CompressionLevel Optimal
$archiveHash = Get-FileHash -LiteralPath $archivePath -Algorithm SHA256
Set-Content -LiteralPath $checksumPath -Encoding ASCII -Value ($archiveHash.Hash + "  " + (Split-Path -Leaf $archivePath))
Copy-Item -LiteralPath $archivePath -Destination $sendArchivePath -Force

$packageSize = (Get-ChildItem -LiteralPath $packageDirectory -File -Recurse | Measure-Object -Property Length -Sum).Sum
$archiveSize = (Get-Item -LiteralPath $archivePath).Length
[PSCustomObject]@{
  Package = $packageDirectory
  Archive = $archivePath
  SendArchive = $sendArchivePath
  PackageMB = [Math]::Round($packageSize / 1MB, 2)
  ArchiveMB = [Math]::Round($archiveSize / 1MB, 2)
  SHA256 = $archiveHash.Hash
}
