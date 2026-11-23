#!/usr/bin/env bash
# Builds PhoneBox.app and a .dmg from a published macOS agent. Needs a Mac (hdiutil). Used by scripts/build.sh and release.yml.
#
#   tools/make-macos-dmg.sh app <published dir> <version> <PhoneBox.app>   # wrap the published agent in an app bundle
#   tools/make-macos-dmg.sh dmg <PhoneBox.app> <version> <out.dmg>         # put the app and an Applications shortcut in a disk image
#
# It does not sign anything. Sign the .app between the two steps: release.yml and build.yml use the
# sign-macos-agent action (the same certificate and identifier as the zip, so the designated requirement is the same as
# the zip's and stays the same from release to release), scripts/build.sh signs ad hoc.
#
# There is no tray icon on macOS, so the app has no Dock icon or window (LSUIElement): it runs in the background and the
# settings are at http://127.0.0.1:8765. The agent's identifier and the bundle identifier are the same on purpose.
set -euo pipefail

usage() { sed -n '2,13p' "$0" >&2; exit 2; }
[ $# -eq 4 ] || usage
mode="$1"; a="$2"; version="$3"; b="$4"

case "$mode" in
  app)
    src="$a"; app="$b"
    [ -x "$src/PhoneBoxAgent" ] || { echo "no PhoneBoxAgent in $src" >&2; exit 1; }
    rm -rf "$app"
    mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
    # Only the executable goes in MacOS: codesign treats every other file there as code that must be signed itself. The
    # rest (the third-party notices, copies of what the agent embeds) is data, so it goes in Resources. Debug symbols stay out.
    # The self-contained single-file agent has no loose native libraries today. If one ever appears it would belong next to
    # the executable and must be signed, which this script does not do: stop here rather than leave it out of the app.
    if find "$src" -maxdepth 1 -name '*.dylib' | grep -q .; then
      echo "native libraries (*.dylib) next to PhoneBoxAgent in $src: make-macos-dmg.sh has to put them in Contents/MacOS and sign them" >&2
      exit 1
    fi
    cp "$src/PhoneBoxAgent" "$app/Contents/MacOS/PhoneBoxAgent"
    icon="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/packaging/macos/PhoneBox.icns"
    [ -f "$icon" ] || { echo "the app icon is missing: $icon (made by tools/make-macos-icon.swift)" >&2; exit 1; }
    cp "$icon" "$app/Contents/Resources/PhoneBox.icns"
    find "$src" -maxdepth 1 -type f ! -name PhoneBoxAgent ! -name '*.pdb' -exec cp {} "$app/Contents/Resources/" \;
    [ -x "$app/Contents/MacOS/PhoneBoxAgent" ] || { echo "copying the agent into the app failed" >&2; exit 1; }
    cat > "$app/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>PhoneBox</string>
  <key>CFBundleDisplayName</key><string>PhoneBox</string>
  <key>CFBundleIdentifier</key><string>net.oxog.phonebox.agent</string>
  <key>CFBundleExecutable</key><string>PhoneBoxAgent</string>
  <key>CFBundleIconFile</key><string>PhoneBox</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
EOF
    plutil -lint "$app/Contents/Info.plist" >/dev/null
    ;;
  dmg)
    app="$a"; dmg="$b"
    command -v hdiutil >/dev/null || { echo "hdiutil only exists on macOS" >&2; exit 1; }
    [ -d "$app/Contents/MacOS" ] || { echo "$app is not an app bundle" >&2; exit 1; }
    stage="$(mktemp -d "${TMPDIR:-/tmp}/phonebox-dmg.XXXXXX")"
    trap 'rm -rf "$stage"' EXIT
    cp -R "$app" "$stage/PhoneBox.app"
    ln -s /Applications "$stage/Applications"
    mkdir -p "$(dirname "$dmg")"
    # hdiutil sizes the image itself and sometimes gets it wrong, failing with "No space left on device" whatever the free
    # space (seen on an external drive and on a CI runner): give it the size, with room for the filesystem.
    kb="$(du -sk "$stage" | cut -f1)"
    mb=$(( kb / 1024 * 14 / 10 + 24 ))
    rm -f "$dmg"
    hdiutil create -volname "PhoneBox $version" -srcfolder "$stage" -fs HFS+ -size "${mb}m" -format UDZO "$dmg" >/dev/null
    ;;
  *) usage ;;
esac
