$ErrorActionPreference = 'Stop'
$tag = '20221029'
$archive = Join-Path $env:TEMP 'nx-motion-rife-20221029.zip'
$expected = 'd8e4d772d26cd8006ef0ad0bc82eb191b53c68677d1ae2f42506d74cbbbea606'
if (!(Test-Path $archive) -or (Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $expected) {
    Invoke-WebRequest "https://github.com/nihui/rife-ncnn-vulkan/releases/download/$tag/rife-ncnn-vulkan-$tag-windows.zip" -OutFile $archive
}
if ((Get-FileHash $archive -Algorithm SHA256).Hash.ToLower() -ne $expected) { throw 'RIFE download checksum mismatch' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$destination = Join-Path $PSScriptRoot '../vendor/rife'
[IO.Directory]::CreateDirectory($destination) | Out-Null
$zip = [IO.Compression.ZipFile]::OpenRead($archive)
try {
    foreach ($name in @('rife-ncnn-vulkan.exe', 'vcomp140.dll', 'LICENSE', 'README.md', 'rife-v4.6/flownet.bin', 'rife-v4.6/flownet.param')) {
        $entry = $zip.GetEntry("rife-ncnn-vulkan-$tag-windows/$name")
        if (!$entry) { throw "Missing RIFE file: $name" }
        $target = Join-Path $destination $name
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($target)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)
    }
} finally { $zip.Dispose() }
