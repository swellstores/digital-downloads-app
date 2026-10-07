#!/bin/sh
# Renders the listing pages into ../../assets with headless Chrome.
set -e
cd "$(dirname "$0")"
python3 build.py
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
ASSETS="$(cd ../../assets && pwd)"
mkdir -p "$ASSETS/screenshots"

render() { # html width height scale output
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor="$4" \
    --window-size="$2,$3" --screenshot="$5" "file://$PWD/$1" 2>/dev/null
}

render icon.html 512 512 1 "$ASSETS/icon.png"
render image.html 1200 630 1 "$ASSETS/image.png"
for page in 1-private-downloads-page 2-files-links-and-keys 3-control-every-order 4-license-keys; do
  render "$page.html" 1600 900 2 "$ASSETS/screenshots/$page.png"
done
ls -1 "$ASSETS" "$ASSETS/screenshots"
