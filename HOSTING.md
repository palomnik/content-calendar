# Hosting Content Calendar

This app is built as a **static export** for fully-offline operation.

## Option A — Local Development (`localhost:3001`)

For quick testing with hot-reload (requires the dev server):

```bash
cd /Users/strannik/Library/CloudStorage/Dropbox/Code/Content_Calendar
npx next dev --port 3001
```

Then open [http://localhost:3001](http://localhost:3001).

> ⚠️ Dev mode (`next dev`) does **not** build the static export — the site runs dynamically. This is fine for browser testing, but for iOS OTA distribution or true offline use you need the static build.

## Option B — Static Export + Caddy (External Domain)

For real hosting on a public domain with HTTPS:

### 1. Configure your domain

Edit `Caddyfile` and replace `:80` with your actual domain:

```caddyfile
contentcalendar.example.com {
  root * /Users/strannik/Library/CloudStorage/Dropbox/Code/Content_Calendar/www
  encode gzip
  try_files {path} {path}/ /index.html
  file_server
}
```

### 2. Build and copy assets

```bash
cd /Users/strannik/Library/CloudStorage/Dropbox/Code/Content_Calendar
npx next build                           # exports static site to www/
cp public/sql-wasm.wasm www/             # ensures WASM is in the export
```

### 3. Fix iOS page structure

```bash
mkdir -p www/ios
mv www/ios.html www/ios/index.html       # Next.js exports /ios as ios.html
rm -f www/ios.txt
```

### 4. Update OTA links

Replace `contentcalendar.example.com` in these files with your real domain:

- `www/ios/manifest.plist` — the `.ipa` download URL
- `www/ios/index.html` — the "Install on iOS Device" button link

Or run the deploy script:

```bash
./deploy.sh contentcalendar.example.com
```

### 5. Start Caddy

```bash
caddy run --config ./Caddyfile
```

Caddy will automatically provision HTTPS via Let's Encrypt.

## Option C — Quick one-liner

The `deploy.sh` script handles steps 2–5 automatically:

```bash
./deploy.sh contentcalendar.example.com
```

## OTA iOS Distribution Requirements

For the "Install from Web" button to work on real iOS devices, you need:

1. **An HTTPS domain** (Caddy handles this automatically)
2. **A signed `.ipa` file** — build it in Xcode:
   - Open `ios/App/App.xcodeproj`
   - Select **Any iOS Device (arm64)**
   - **Product → Archive**
   - **Distribute App → Ad Hoc → Export**
   - Place the exported `.ipa` into `public/ios/ContentCalendar.ipa`
3. **Re-build** with `./deploy.sh` so the `.ipa` gets copied into `www/ios/`

## Architecture Notes

- **Browser**: Uses IndexedDB (via `sql.js` WASM) to persist the SQLite database
- **iOS (Capacitor)**: Uses native Filesystem to persist `content_calendar.db` in the app Documents directory
- **Data interchange**: Both versions speak the same JSON and `.db` formats via Import/Export

## Troubleshooting

**WASM not loading?** Make sure `sql-wasm.wasm` is in `www/` after build. The deploy script copies it automatically.

**iOS install link not working?** iOS requires:
- HTTPS (not HTTP)
- Valid `manifest.plist` with correct domain
- A real signed `.ipa` file

**Can't import .db in browser?** Use the `.json` export instead for browser ↔ iOS transfers. Binary `.db` import works best iOS-to-iOS.
