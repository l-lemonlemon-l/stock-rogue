# Upload both builds to Steam (Windows PowerShell).
# 1. Download the steamworks SDK, note the path to tools\ContentBuilder\builder\steamcmd.exe
# 2. Put the unzipped GitHub Action outputs in:
#      steam\builds\windows\   (contains "Stock Rogue.exe")
#      steam\builds\mac\       (contains "Stock Rogue.app")
# 3. Replace APP_ID / WIN_DEPOT_ID / MAC_DEPOT_ID in the .vdf files.
# 4. Run: .\steam\upload.ps1 -User yoursteambuildaccount -SteamCmd C:\steamworks_sdk\tools\ContentBuilder\builder\steamcmd.exe
param([string]$User, [string]$SteamCmd)
$vdf = Join-Path $PSScriptRoot "app_build.vdf"
& $SteamCmd +login $User +run_app_build $vdf +quit
