#!/usr/bin/env bash
# Checks a PhoneBox .dmg the way a user's Mac meets it (macOS only):
#   tools/check-macos-dmg.sh <PhoneBox.dmg> <signed PhoneBoxAgent from the zip> <version>
#
# 1. the disk image mounts and holds PhoneBox.app and the Applications shortcut
# 2. the app's signature verifies, and its designated requirement is the same as the zip's agent (identical certificate and
#    identifier), so the app is signed by the same identity as every other PhoneBox build. That is what keeps a grant across
#    updates of the app itself; it does not make macOS share a grant between a bare executable (recorded by path) and an
#    app (recorded by bundle id), so someone moving between the two allows Accessibility once more
# 3. the agent inside, copied out of the read-only image, starts and serves its API (tools/smoke-agent.py)
set -euo pipefail

[ $# -eq 3 ] || { sed -n '2,9p' "$0" >&2; exit 2; }
dmg="$1"; zipagent="$2"; version="$3"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

work="$(mktemp -d "${TMPDIR:-/tmp}/phonebox-dmgcheck.XXXXXX")"
mount="$work/mount"
mkdir -p "$mount"
cleanup() { hdiutil detach "$mount" -quiet 2>/dev/null || true; rm -rf "$work"; }
trap cleanup EXIT

hdiutil attach "$dmg" -nobrowse -readonly -mountpoint "$mount" >/dev/null
[ -d "$mount/PhoneBox.app" ] || { echo "::error::PhoneBox.app is missing from the disk image"; exit 1; }
[ -L "$mount/Applications" ] || { echo "::error::the Applications shortcut is missing from the disk image"; exit 1; }

cp -R "$mount/PhoneBox.app" "$work/PhoneBox.app"
app="$work/PhoneBox.app"
[ -f "$app/Contents/Resources/PhoneBox.icns" ] || { echo "::error::the app has no icon (Contents/Resources/PhoneBox.icns)"; exit 1; }
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$app/Contents/Info.plist")" = PhoneBox ] || { echo "::error::Info.plist does not name the icon"; exit 1; }
codesign --verify --deep --strict --verbose=2 "$app"

req() { codesign -d -r- "$1" 2>&1 | sed -n 's/^designated => //p'; }
app_req="$(req "$app")"
zip_req="$(req "$zipagent")"
echo "app: $app_req"
echo "zip: $zip_req"
[ -n "$app_req" ] && [ "$app_req" = "$zip_req" ] || { echo "::error::the app's designated requirement differs from the zip agent's"; exit 1; }

python3 "$root/tools/smoke-agent.py" "$app/Contents/MacOS/PhoneBoxAgent" --version "$version"
echo "PASS: $(basename "$dmg")"
