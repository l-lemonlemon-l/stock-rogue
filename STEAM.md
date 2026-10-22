# Shipping Stock Rogue on Steam (Windows + Mac)

## How the pieces fit
- **Desktop app** (`desktop/`): Electron wraps the game. It runs a copy of the server inside the app for solo and LAN play.
- **Online server**: the same `server/` code deployed to the internet. The desktop app connects to it when "Online" is picked. Address is `onlineServer` in `desktop/config.json`.
- **Steam**: `steamworks.js` gives the Steam overlay, the player's Steam name, and achievements.

## 1. Test locally
```
npm install
npm run desktop
```
Without Steam running it still works, just without achievements. With Steam open it uses test app 480 (Spacewar).

## 2. Put the online server up
Easiest is Fly.io (free tier is enough to start):
```
fly launch --copy-config --name stock-rogue
fly deploy
```
Then set `onlineServer` in `desktop/config.json` to `wss://stock-rogue.fly.dev` (or your name). Any VPS with Docker works too: `docker build -t stock-rogue . && docker run -p 8080:8080 stock-rogue`, behind HTTPS.

## 3. Steamworks setup (partner.steamgames.com)
1. Pay the Steam Direct fee ($100 per game) and create the app. You get an **App ID**.
2. Under SteamPipe > Depots, create two depots: one set to Windows, one set to macOS. Note both **Depot IDs**.
3. Under Installation > General, add two launch options:
   - Windows: executable `Stock Rogue.exe`, OS Windows
   - macOS: executable `Stock Rogue.app`, OS macOS
4. Under Stats & Achievements, create all 37 achievements. Run `node tools/steam-achievements.js` to print the
   API names, display names, descriptions and which ones are hidden. API names must match exactly.
   Achievements are tracked in the game itself too, so players see them even when Steam is offline;
   the game re-sends unlocked ones to Steam at every launch.
5. Publish the Steamworks settings.
6. In `desktop/config.json` set `steamAppId` to your App ID and `requireSteam` to `true`.

## 4. Build Windows + Mac
Mac builds have to happen on a Mac, so the repo includes a GitHub Action that builds both:
1. Push the project to GitHub (e.g. `l-lemonlemon-l/stock-rogue`).
2. Actions tab > build > Run workflow (or push a tag like `v1.0.0`).
3. Download the `stock-rogue-windows` and `stock-rogue-mac` artifacts.

Windows-only build on your own PC: `npm run dist:win` -> `dist/win-unpacked/`.

### Mac signing (needed so Mac players don't get "app is damaged")
Needs an Apple Developer account ($99/year). Add these GitHub repo secrets and the Action signs and notarizes automatically:
- `MAC_CERT_P12_BASE64` - your "Developer ID Application" certificate exported as .p12, base64 encoded
- `MAC_CERT_PASSWORD` - the .p12 password
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

Windows code signing is optional for Steam (Steam installs it, so SmartScreen does not block it).

## 5. Upload to Steam
1. Download the Steamworks SDK from the partner site.
2. Unzip the artifacts into `steam/builds/windows/` and `steam/builds/mac/`.
3. Replace `APP_ID`, `WIN_DEPOT_ID`, `MAC_DEPOT_ID` in `steam/*.vdf`.
4. Run (PowerShell):
   ```
   .\steam\upload.ps1 -User yourbuildaccount -SteamCmd C:\steamworks_sdk\tools\ContentBuilder\builder\steamcmd.exe
   ```
5. In Steamworks > SteamPipe > Builds, set the new build live on a branch (start with a private `beta` branch).

## Save data and Steam Cloud
The player's permanent save (certificates, Item Shop upgrades, rebirths, achievements, run history) is stored by the desktop app in its user data folder:
- Windows: `%APPDATA%/Stock Rogue/Local Storage`
- Mac: `~/Library/Application Support/Stock Rogue/Local Storage`

To sync it between computers, turn on Steam Auto-Cloud (Steamworks > Application > Steam Cloud) with those folders as root paths.

## 6. Before release checklist
- Store page: capsule images, at least 5 screenshots, trailer, description, tags (Roguelike, Trading, Multiplayer, Strategy).
- Store page must be "Coming Soon" for at least 2 weeks before launch; build review takes a few days.
- Replace `build/icon.png` (1024x1024) with your real icon.
- Bump `version` in `package.json` each build.
- Test on a real Mac and the Steam overlay (Shift+Tab) on both platforms.

## Later: Steam-native multiplayer
Right now online play goes through your own server. Steam lobbies (`steam.matchmaking`) can replace room codes with "Invite friend" through the overlay. The room code would be stored in lobby data, so the server code doesn't change.
