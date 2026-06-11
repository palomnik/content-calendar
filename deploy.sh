#!/bin/bash
# deploy.sh — Build and deploy Content Calendar static site
# Usage: ./deploy.sh [YOUR_DOMAIN]
# Example: ./deploy.sh contentcalendar.example.com

set -e

DOMAIN="${1:-localhost}"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
WWW_DIR="$PROJECT_DIR/www"

echo "🚀 Building Content Calendar for domain: $DOMAIN"

# 1. Build static export
cd "$PROJECT_DIR"
npx next build

# 2. Ensure WASM is in www/
cp "$PROJECT_DIR/public/sql-wasm.wasm" "$WWW_DIR/"

# 3. Re-organize ios files if needed
if [ -f "$WWW_DIR/ios.html" ]; then
  mkdir -p "$WWW_DIR/ios"
  mv "$WWW_DIR/ios.html" "$WWW_DIR/ios/index.html"
  rm -f "$WWW_DIR/ios.txt"
fi

# 4. Update manifest.plist with the actual domain
MANIFEST="$WWW_DIR/ios/manifest.plist"
if [ -f "$MANIFEST" ]; then
  sed -i '' "s|https://contentcalendar.example.com|https://$DOMAIN|g" "$MANIFEST"
  echo "✅ Updated manifest.plist for https://$DOMAIN"
else
  echo "⚠️  manifest.plist not found — skipping OTA manifest update"
fi

# 5. Update the OTA link on the iOS page
IOS_PAGE="$WWW_DIR/ios/index.html"
if [ -f "$IOS_PAGE" ]; then
  sed -i '' "s|https://contentcalendar.example.com|https://$DOMAIN|g" "$IOS_PAGE"
  echo "✅ Updated iOS page links"
fi

# 6. Update Caddyfile root path
CADDYFILE="$PROJECT_DIR/Caddyfile"
if [ -f "$CADDYFILE" ] && command -v caddy >/dev/null 2>&1; then
  sed -i '' "s|:80 {|$DOMAIN {|" "$CADDYFILE" 2>/dev/null || true
  echo "🔄 Starting Caddy..."
  caddy run --config "$CADDYFILE" &
  echo "✅ Caddy serving at https://$DOMAIN"
else
  echo "ℹ️  Caddy not found or Caddyfile missing — skipping server start"
fi

echo ""
echo "📦 Deploy complete. Static export is in: $WWW_DIR"
echo "🌐 Access the app at: https://$DOMAIN"
echo "📱 iOS download page: https://$DOMAIN/ios/"
