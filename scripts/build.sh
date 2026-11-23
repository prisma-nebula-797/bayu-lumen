#!/usr/bin/env bash
# Builds the PhoneBox agent as ready-to-run files from a checkout. Works on macOS and Linux (build.ps1 does the same on Windows).
#
#   ./scripts/build.sh                  # for this machine: macOS -> .dmg, Linux -> .tar.gz
#   ./scripts/build.sh osx-arm64        # one target:  linux-x64 | linux-arm64 | osx-arm64 | osx-x64
#   ./scripts/build.sh all              # every target buildable here
#
# Output lands in dist/ (not tracked by git):
#   osx-*       PhoneBox-<version>-<rid>.dmg    PhoneBox.app + an Applications shortcut (the .dmg itself needs a Mac)
#   linux-*     PhoneBoxAgent-<version>-<rid>.tar.gz    a single executable file; the archive keeps the run bit
#
# Every file is self-contained: no .NET runtime is needed to run it. Building needs the .NET 10 SDK (or newer).
# The .dmg is ad-hoc signed, so a copy downloaded to another Mac is blocked the first time (System Settings > Privacy & Security >
# Open Anyway; right-click > Open only works up to macOS 14); the
# official releases come from the GitHub release workflow. The Windows .exe (tray icon, WinForms) can only be built
# on Windows: run scripts/build.ps1 there.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
proj="$root/agent/PhoneBox.Agent"
dist="$root/dist"

case "$(uname -s)" in
  Darwin) host=osx ;;
  Linux) host=linux ;;
  *) echo "Use scripts/build.ps1 on Windows." >&2; exit 1 ;;
esac
case "$(uname -m)" in
  arm64|aarch64) arch=arm64 ;;
  *) arch=x64 ;;
esac

command -v dotnet >/dev/null || { echo "The .NET SDK is missing: https://dotnet.microsoft.com/download" >&2; exit 1; }

version="$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' "$proj/PhoneBox.Agent.csproj" | head -n1)"
[ -n "$version" ] || { echo "Could not read the version from PhoneBox.Agent.csproj" >&2; exit 1; }

target="${1:-$host-$arch}"
if [ "$target" = all ]; then targets="linux-x64 linux-arm64 osx-arm64 osx-x64"; else targets="$target"; fi

# a .dmg needs hdiutil, which only exists on macOS: say so now instead of publishing a build that is then thrown away
if ! command -v hdiutil >/dev/null; then
  case "$target" in
    osx-*) echo "A macOS .dmg can only be built on a Mac (hdiutil). Take the .dmg or the zip from a release instead." >&2; exit 1 ;;
    all) targets="linux-x64 linux-arm64"; echo "Skipping the macOS targets: a .dmg can only be built on a Mac." >&2 ;;
  esac
fi

mkdir -p "$dist"
work="$(mktemp -d "${TMPDIR:-/tmp}/phonebox-build.XXXXXX")"
trap 'rm -rf "$work"' EXIT

publish() { # publish <rid> <out dir>
  local rid="$1" out="$2"
  # Same switches as .github/workflows/release.yml: self-contained, one file, native libraries kept loose.
  dotnet publish "$proj" -c Release -f net10.0 -r "$rid" --self-contained true -p:PublishSingleFile=true \
    -o "$out" --nologo -v q --disable-build-servers
}

make_dmg() { # make_dmg <rid> <published dir>
  local rid="$1" out="$2" app="$work/PhoneBox-$1.app" dmg="$dist/PhoneBox-$version-$1.dmg"
  "$root/tools/make-macos-dmg.sh" app "$out" "$version" "$app"
  # Ad hoc signing makes macOS accept the unsigned binary. Releases sign with PhoneBox's own certificate instead
  # (.github/actions/sign-macos-agent), so a copy built here has a different identity from a release and has to be allowed again.
  codesign --force --deep --sign - --identifier net.oxog.phonebox.agent "$app" >/dev/null 2>&1
  "$root/tools/make-macos-dmg.sh" dmg "$app" "$version" "$dmg"
  echo "  $dmg"
}

for rid in $targets; do
  case "$rid" in
    linux-x64|linux-arm64|osx-arm64|osx-x64) ;;
    win-x64) echo "The Windows .exe has to be built on Windows: run scripts\\build.ps1 there, or take it from a GitHub release." >&2; exit 1 ;;
    *) echo "Unknown target '$rid' (linux-x64, linux-arm64, osx-arm64, osx-x64, all)" >&2; exit 1 ;;
  esac
  echo "==> PhoneBox agent $version for $rid"
  out="$work/out-$rid"
  publish "$rid" "$out"
  case "$rid" in
    osx-*) make_dmg "$rid" "$out" ;;
    linux-*)
      chmod +x "$out/PhoneBoxAgent"
      tar -C "$out" -czf "$dist/PhoneBoxAgent-$version-$rid.tar.gz" .
      echo "  $dist/PhoneBoxAgent-$version-$rid.tar.gz" ;;
  esac
done
