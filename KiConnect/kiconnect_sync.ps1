<#
    kiconnect_sync.ps1
    ------------------
    Does the actual file-level sync for update.bat, using GitHub's Git
    Trees API instead of downloading the whole repo as a zip every time.

    How it works:
      1. Ask GitHub for the full file tree of the branch, recursively, in
         one call (path + blob SHA per file - no file contents):
           GET /repos/<owner>/<repo>/git/trees/<branch>?recursive=1
      2. Compare each file's SHA against a locally saved manifest
         (kiconnect_manifest.json, {"comm/js/...": "<sha>", ...}) from the
         last successful sync.
      3. Download only files that are new or whose SHA changed.
      4. Delete local files under comm\ that no longer exist in the tree
         upstream (mirrors GitHub exactly), EXCEPT anything under
         comm\datas\ or comm\_render\ - those are never touched, no matter
         what the tree looks like.
      5. Write the new manifest back, so the next run only has to diff
         against it (a single small API call) instead of re-downloading
         everything.

    Deliberately NOT touched by this script (handled elsewhere / never):
      - comm\datas\        (local account data)
      - comm\_render\      (vendored libs, fetched separately as a zip by
                             update.bat's ensure_render step)
      - update.bat, START.bat, START_portable.bat
                            (self-updated by update.bat itself, "for next
                             run only" - these are cmd.exe-interpreted
                             files that may currently be executing/paused
                             on the call stack while this script runs, so
                             overwriting them now would be the same kind
                             of self-modification issue update.bat's own
                             self-update comment already warns about)
      - this script itself (update.bat refreshes it, if needed, via a
                             plain fetch-and-compare *before* launching
                             it - never while it's running)

    Exit codes (read by update.bat):
      0 = synced successfully (0 or more files changed)
      1 = fatal error (tree could not be fetched/parsed) - caller should
          just skip this run's sync, nothing on disk was touched
      2 = GitHub reported the tree as truncated (extremely large repo) -
          caller should fall back to the old full-zip sync as a safety net
#>

param(
    [string]$RepoOwner   = 'Waldemar-Koch-git',
    [string]$RepoName    = 'KiConnect',
    [string]$Branch      = 'main',
    # Folder inside the repo that corresponds to the local installation
    # root (repo layout is <root>/KiConnect/{START.bat,comm/,...}).
    [string]$RepoSubdir  = 'KiConnect',
    [Parameter(Mandatory = $true)][string]$LocalRoot,
    [Parameter(Mandatory = $true)][string]$ManifestPath
)

$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'   # avoid slow progress-bar rendering on downloads
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch {}

function Log-Info { param([string]$msg) Write-Host "  [INFO] $msg" }
function Log-Ok   { param([string]$msg) Write-Host "  [ OK ] $msg" }
function Log-Warn { param([string]$msg) Write-Host "  [ !! ] $msg" }

# Paths under comm\ that must never be downloaded into, overwritten, or
# deleted by this script, no matter what the upstream tree contains.
$ProtectedPrefixes = @('comm/datas/', 'comm/_render/')

function Is-Protected([string]$relPath) {
    foreach ($p in $ProtectedPrefixes) { if ($relPath.StartsWith($p, [StringComparison]::OrdinalIgnoreCase)) { return $true } }
    return $false
}

# ── 1. Fetch the recursive tree ──────────────────────────────────────
$treeUrl = "https://api.github.com/repos/$RepoOwner/$RepoName/git/trees/$Branch`?recursive=1"
try {
    $headers = @{ 'User-Agent' = 'KiConnect-Updater'; 'Accept' = 'application/vnd.github+json' }
    $tree = Invoke-RestMethod -Uri $treeUrl -Headers $headers -Method Get
} catch {
    Log-Warn "Could not fetch the file tree from GitHub: $($_.Exception.Message)"
    exit 1
}

if ($tree.truncated) {
    Log-Warn "GitHub reported the tree as truncated - falling back to a full sync."
    exit 2
}

# ── 2. Build the new manifest (relative path -> blob SHA), scoped to
#      RepoSubdir/comm/ and with protected paths stripped out ──────────
$prefix = "$RepoSubdir/comm/"
$newManifest = @{}
foreach ($entry in $tree.tree) {
    if ($entry.type -ne 'blob') { continue }
    if (-not $entry.path.StartsWith($prefix)) { continue }
    $relPath = $entry.path.Substring($RepoSubdir.Length + 1)   # e.g. "comm/js/core/boot.js"
    if (Is-Protected $relPath) { continue }
    $newManifest[$relPath] = $entry.sha
}

if ($newManifest.Count -eq 0) {
    Log-Warn "Tree lookup returned no files under '$prefix' - refusing to sync (would look like 'delete everything')."
    exit 1
}

# ── 3. Load the old manifest, if any (missing = first run of this
#      sync mechanism; every existing file is a delete-candidate below,
#      which is exactly what cleans up pre-v4.0.0 leftovers like the old
#      kiconnect.js/-agent.js/-voice.js/-db.js) ─────────────────────────
$oldManifest = @{}
if (Test-Path $ManifestPath) {
    try {
        $raw = Get-Content -Raw -Path $ManifestPath | ConvertFrom-Json
        foreach ($prop in $raw.PSObject.Properties) { $oldManifest[$prop.Name] = $prop.Value }
    } catch {
        Log-Warn "Local manifest is unreadable/corrupt - treating as first run (full reconcile)."
        $oldManifest = @{}
    }
}

# ── 4. Diff: what to download ───────────────────────────────────────
$toDownload = @()
foreach ($relPath in $newManifest.Keys) {
    if (-not $oldManifest.ContainsKey($relPath) -or $oldManifest[$relPath] -ne $newManifest[$relPath]) {
        $toDownload += $relPath
    }
}

# ── 5. Diff: what to delete. Based on what's ACTUALLY on disk under
#      comm\ right now (not on the old manifest) - self-healing even if
#      the manifest is stale, missing, or this is a migration from an
#      installation that predates it entirely. ─────────────────────────
$commRoot = Join-Path $LocalRoot 'comm'
$toDelete = @()
if (Test-Path $commRoot) {
    Get-ChildItem -Path $commRoot -File -Recurse | ForEach-Object {
        $rel = $_.FullName.Substring($LocalRoot.Length).TrimStart('\', '/') -replace '\\', '/'
        if (Is-Protected $rel) { return }
        if (-not $newManifest.ContainsKey($rel)) { $toDelete += $rel }
    }
}

if ($toDownload.Count -eq 0 -and $toDelete.Count -eq 0) {
    Log-Ok "comm\ already matches upstream - nothing to sync."
} else {
    Log-Info "$($toDownload.Count) file(s) to update/add, $($toDelete.Count) file(s) to remove."
}

# ── 6. Delete removed files (mirror GitHub exactly) ─────────────────
foreach ($rel in $toDelete) {
    $full = Join-Path $LocalRoot $rel
    try {
        Remove-Item -LiteralPath $full -Force
        Log-Info "Removed (no longer on GitHub): $rel"
    } catch {
        Log-Warn "Could not remove $rel : $($_.Exception.Message)"
    }
}

# Clean up any directories under comm\ left empty by the deletions above
# (skip the protected trees entirely, they may legitimately be sparse/empty).
if (Test-Path $commRoot) {
    Get-ChildItem -Path $commRoot -Directory -Recurse |
        Where-Object {
            $rel = $_.FullName.Substring($LocalRoot.Length).TrimStart('\', '/') -replace '\\', '/'
            -not (Is-Protected "$rel/")
        } |
        Sort-Object { $_.FullName.Length } -Descending |
        ForEach-Object {
            if (-not (Get-ChildItem -Path $_.FullName -Force | Select-Object -First 1)) {
                Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
            }
        }
}

# ── 7. Download new/changed files ────────────────────────────────────
$failed = @()
foreach ($rel in $toDownload) {
    $rawUrl = "https://raw.githubusercontent.com/$RepoOwner/$RepoName/$Branch/$RepoSubdir/$rel"
    $dest   = Join-Path $LocalRoot $rel
    $destDir = Split-Path -Parent $dest
    try {
        if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Path $destDir -Force | Out-Null }
        $tmp = "$dest.tmp"
        Invoke-WebRequest -Uri $rawUrl -Headers @{ 'User-Agent' = 'KiConnect-Updater' } -OutFile $tmp
        Move-Item -LiteralPath $tmp -Destination $dest -Force   # atomic-ish swap, avoids half-written files on failure
        Log-Info "Updated: $rel"
    } catch {
        Log-Warn "Failed to download $rel : $($_.Exception.Message)"
        $failed += $rel
        if (Test-Path "$dest.tmp") { Remove-Item -LiteralPath "$dest.tmp" -Force -ErrorAction SilentlyContinue }
    }
}

# ── 8. Write the new manifest. Files that failed to download keep their
#      OLD manifest value (if any) so they're retried next run instead of
#      being silently marked as current. ─────────────────────────────
$finalManifest = @{}
foreach ($relPath in $newManifest.Keys) {
    if ($failed -contains $relPath) {
        if ($oldManifest.ContainsKey($relPath)) { $finalManifest[$relPath] = $oldManifest[$relPath] }
        # else: never successfully synced yet - omit, so it's retried next run.
    } else {
        $finalManifest[$relPath] = $newManifest[$relPath]
    }
}

try {
    $tmpManifest = "$ManifestPath.tmp"
    $finalManifest | ConvertTo-Json -Depth 5 | Set-Content -Path $tmpManifest -Encoding UTF8
    Move-Item -LiteralPath $tmpManifest -Destination $ManifestPath -Force
} catch {
    Log-Warn "Could not save the updated manifest: $($_.Exception.Message)"
}

if ($failed.Count -gt 0) {
    Log-Warn "$($failed.Count) file(s) could not be updated this run - will retry next time."
} else {
    Log-Ok "Sync complete."
}

exit 0
