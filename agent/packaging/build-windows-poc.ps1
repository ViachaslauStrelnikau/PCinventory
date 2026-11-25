[CmdletBinding()]
param(
    [string]$Maven = 'mvn.cmd',
    [string]$SevenZip = '7z.exe',
    [string]$DownloadCache,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$agent = Split-Path -Parent $PSScriptRoot
$target = Join-Path $agent 'target'
if (-not $OutputDirectory) {
    $OutputDirectory = Join-Path $target 'windows'
}
if (-not $DownloadCache) {
    $DownloadCache = Join-Path $target 'downloads'
}
New-Item -ItemType Directory -Path $DownloadCache, $OutputDirectory -Force | Out-Null
$DownloadCache = (Resolve-Path -LiteralPath $DownloadCache).Path
$output = (Resolve-Path -LiteralPath $OutputDirectory).Path

function Get-VerifiedArchive([string]$Name, [string]$Url, [string]$Sha256) {
    $path = Join-Path $DownloadCache $Name
    if (-not (Test-Path -LiteralPath $path)) {
        $partial = "$path.$([guid]::NewGuid().ToString('N')).partial"
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $partial
            if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $Sha256) {
                throw "SHA-256 mismatch: $Name"
            }
            Move-Item -LiteralPath $partial -Destination $path
        } finally {
            if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial }
        }
    }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $Sha256) {
        throw "SHA-256 mismatch: $path"
    }
    return $path
}

$jreZip = Get-VerifiedArchive 'bellsoft-jre8u514+5-windows-i586.zip' `
    'https://github.com/bell-sw/Liberica/releases/download/8u514%2B5/bellsoft-jre8u514%2B5-windows-i586.zip' `
    'B7B2CE5B770794D36C3B90261713A1FAD514A9A3D8E9EE33C138A3CA8AE37938'
$sdkArchive = Get-VerifiedArchive 'lzma2606.7z' `
    'https://github.com/ip7z/7zip/releases/download/26.06/lzma2606.7z' `
    '1D9DA340870B12712E9068BE178A4436FBAD785486B62AED6E2AA88EA1E3BB65'

$scratch = Join-Path $target ("packaging-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $scratch | Out-Null
try {
    $payload = Join-Path $scratch 'payload'
    $licenses = Join-Path $payload 'licenses'
    New-Item -ItemType Directory -Path $licenses -Force | Out-Null
    $pom = Join-Path $agent 'pom.xml'
    & $Maven -B --no-transfer-progress -f $pom verify `
        org.apache.maven.plugins:maven-dependency-plugin:3.7.0:unpack-dependencies `
        '-DincludeScope=runtime' '-Dmdep.useSubDirectoryPerArtifact=true' `
        "-DoutputDirectory=$licenses" "-DmarkersDirectory=$scratch\license-markers" `
        '-Dmdep.unpack.includes=**/LICENSE*,**/NOTICE*,**/COPYING*,**/COPYRIGHT*,**/AL2.0,**/LGPL2.1'
    if ($LASTEXITCODE -ne 0) { throw "Maven failed ($LASTEXITCODE)" }

    [xml]$project = Get-Content -LiteralPath $pom -Raw
    $jar = Join-Path $target "$($project.project.artifactId)-$($project.project.version).jar"
    Copy-Item -LiteralPath $jar -Destination (Join-Path $payload 'inventory-agent.jar')
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'THIRD-PARTY.txt') -Destination $payload
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'OSHI-LICENSE.txt') -Destination $licenses

    $sdk = Join-Path $scratch 'sdk'
    & $SevenZip x $sdkArchive "-o$sdk" 'bin\7zSD.sfx' 'bin\7zr.exe' -y
    if ($LASTEXITCODE -ne 0) { throw "LZMA SDK extraction failed ($LASTEXITCODE)" }

    $archiveTool = Join-Path $sdk 'bin\7zr.exe'
    & $SevenZip x $jreZip "-o$scratch" -y
    if ($LASTEXITCODE -ne 0) { throw "JRE extraction failed ($LASTEXITCODE)" }
    Move-Item -LiteralPath (Join-Path $scratch 'jre8u514') -Destination (Join-Path $payload 'jre')

    $archive = Join-Path $scratch 'payload.7z'
    Push-Location $payload
    try {
        & $archiveTool a -t7z '-m0=LZMA' '-md=8m' $archive '.\*'
        if ($LASTEXITCODE -ne 0) { throw "Payload compression failed ($LASTEXITCODE)" }
    } finally {
        Pop-Location
    }
    & $archiveTool t $archive
    if ($LASTEXITCODE -ne 0) { throw "Payload verification failed ($LASTEXITCODE)" }

    $stub = Join-Path $sdk 'bin\7zSD.sfx'
    if (-not ('ExecutableManifest' -as [type])) {
        Add-Type -Path (Join-Path $PSScriptRoot 'ExecutableManifest.cs')
    }
    [ExecutableManifest]::Apply($stub, (Join-Path $PSScriptRoot 'InventoryAgent.manifest'))

    $exe = Join-Path $scratch 'InventoryAgent.exe'
    $destination = [IO.File]::OpenWrite($exe)
    try {
        $config = Join-Path $PSScriptRoot 'sfx-config.txt'
        foreach ($component in @($stub, $config, $archive)) {
            $inputFile = [IO.File]::OpenRead($component)
            try { $inputFile.CopyTo($destination) } finally { $inputFile.Dispose() }
        }
    } finally {
        $destination.Dispose()
    }

    $outputExe = Join-Path $output 'InventoryAgent.exe'
    Move-Item -LiteralPath $exe -Destination $outputExe -Force
    $hash = (Get-FileHash -LiteralPath $outputExe -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  InventoryAgent.exe" | Set-Content -LiteralPath "$outputExe.sha256" -Encoding ascii
    Write-Output $outputExe
} finally {
    $resolvedTarget = (Resolve-Path -LiteralPath $target).Path.TrimEnd('\') + '\'
    $resolvedScratch = (Resolve-Path -LiteralPath $scratch).Path
    if ($resolvedScratch.StartsWith($resolvedTarget, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedScratch -Recurse -Force
    }
}
