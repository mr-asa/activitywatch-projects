#!/bin/sh
# Installs or updates the Projects dashboard for ActivityWatch (Linux, macOS).
#   curl -fsSL https://github.com/mr-asa/activitywatch-projects/releases/latest/download/install.sh | sh
# The same script is the updater. On Linux the dashboard's "Update" button runs
# it through the awprojects:// URL scheme registered here (current user only);
# on macOS run the command again. It only touches its own folder and
# aw-server.toml (one added line, backed up first); ActivityWatch data and
# settings are never modified.
#
# Options (for testing): --update  --zip <url|file>  --base <dir>
#                        --config <aw-server.toml>  --no-protocol
set -eu

ZIP='https://github.com/mr-asa/activitywatch-projects/releases/latest/download/activitywatch-projects.zip'
UPDATE=0
NO_PROTOCOL=0
BASE=''
CONFIG=''
while [ $# -gt 0 ]; do
  case "$1" in
    --update) UPDATE=1 ;;
    --zip) ZIP=$2; shift ;;
    --base) BASE=$2; shift ;;
    --config) CONFIG=$2; shift ;;
    --no-protocol) NO_PROTOCOL=1 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s)" = Darwin ]; then
  : "${BASE:=$HOME/Library/Application Support/ActivityWatchProjects}"
  : "${CONFIG:=$HOME/Library/Application Support/activitywatch/aw-server/aw-server.toml}"
  NO_PROTOCOL=1 # macOS has no scriptable URL handler without an app bundle
else
  : "${BASE:=${XDG_DATA_HOME:-$HOME/.local/share}/activitywatch-projects}"
  : "${CONFIG:=${XDG_CONFIG_HOME:-$HOME/.config}/activitywatch/aw-server/aw-server.toml}"
fi
APP="$BASE/app"
LOG="$BASE/install.log"

say() {
  [ "$UPDATE" = 1 ] || echo "$1"
  mkdir -p "$BASE"
  printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >>"$LOG"
}
fail() { say "FAILED: $1"; [ "$UPDATE" = 1 ] && exit 1; echo "$1" >&2; exit 1; }
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}
fetch() { # source target (URL or local file)
  case "$1" in
    http://*|https://*)
      if command -v curl >/dev/null 2>&1; then curl -fsSL "$1" -o "$2"
      else wget -q "$1" -O "$2"; fi ;;
    *) cp "$1" "$2" ;;
  esac
}
unpack() { # zip dir
  mkdir -p "$2"
  if command -v unzip >/dev/null 2>&1; then unzip -q "$1" -d "$2"
  elif command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$1" -C "$2"
  elif command -v python3 >/dev/null 2>&1; then python3 -m zipfile -e "$1" "$2"
  else fail 'Need unzip (or bsdtar, or python3) to unpack the release.'; fi
}
version_of() { sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$1" | head -n1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/awprojects.XXXXXX")
trap 'rm -rf "$WORK"' EXIT

fetch "$ZIP" "$WORK/release.zip" || fail 'Download failed. Nothing was changed.'
fetch "$ZIP.sha256" "$WORK/release.zip.sha256" || fail 'Checksum download failed. Nothing was changed.'
EXPECTED=$(cut -d' ' -f1 "$WORK/release.zip.sha256" | tr 'A-F' 'a-f')
[ "$(sha256 "$WORK/release.zip")" = "$EXPECTED" ] || fail 'Download is corrupted (SHA-256 mismatch). Nothing was changed.'
unpack "$WORK/release.zip" "$WORK/unpacked"
for required in app/index.html app/version.json install.sh; do
  [ -f "$WORK/unpacked/$required" ] || fail "Release is missing $required. Nothing was changed."
done

NEW=$(version_of "$WORK/unpacked/app/version.json")
OLD=''
[ -f "$APP/version.json" ] && OLD=$(version_of "$APP/version.json")
mkdir -p "$BASE"
MOVED=0
if [ -d "$APP" ]; then
  rm -rf "$BASE/app-previous"
  mv "$APP" "$BASE/app-previous"
  MOVED=1
fi
if ! mv "$WORK/unpacked/app" "$APP"; then
  [ "$MOVED" = 1 ] && mv "$BASE/app-previous" "$APP"
  fail 'Could not put the new version in place.'
fi
# Replace the running script atomically (the shell has already read it).
cp "$WORK/unpacked/install.sh" "$BASE/install.sh.new" && chmod +x "$BASE/install.sh.new" && mv -f "$BASE/install.sh.new" "$BASE/install.sh" ||
  say 'Could not refresh install.sh.'

if [ "$NO_PROTOCOL" = 0 ]; then
  DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$DESKTOP_DIR"
  cat >"$DESKTOP_DIR/awprojects-update.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=ActivityWatch Projects updater
Exec="$BASE/install.sh" --update
MimeType=x-scheme-handler/awprojects;
NoDisplay=true
Terminal=false
EOF
  command -v xdg-mime >/dev/null 2>&1 && xdg-mime default awprojects-update.desktop x-scheme-handler/awprojects || true
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DESKTOP_DIR" 2>/dev/null || true
fi

if [ -n "$OLD" ]; then say "Updated $OLD -> $NEW ($APP)"; else say "Installed $NEW ($APP)"; fi

if [ "$UPDATE" = 0 ]; then
  LINE="projects = \"$APP\""
  CONFIG_DIR=$(dirname "$CONFIG")
  if [ ! -d "$CONFIG_DIR" ]; then
    say "ActivityWatch config folder not found. Add this to aw-server.toml yourself:
[server.custom_static]
$LINE"
  elif [ -f "$CONFIG" ] && grep -q '^[[:space:]]*projects[[:space:]]*=' "$CONFIG"; then
    grep -q "^[[:space:]]*projects[[:space:]]*=[[:space:]]*\"$APP\"" "$CONFIG" ||
      say "aw-server.toml already has a 'projects' entry. Left unchanged; point it to $APP to use this install."
  else
    [ -f "$CONFIG" ] && cp "$CONFIG" "$CONFIG.bak-$(date +%Y%m%d-%H%M%S)"
    [ -f "$CONFIG" ] || : >"$CONFIG"
    if grep -q '^\[server\.custom_static\][[:space:]]*$' "$CONFIG"; then
      awk -v line="$LINE" '{ print } /^\[server\.custom_static\][ \t]*$/ { print line }' "$CONFIG" >"$WORK/config.new"
    else
      { cat "$CONFIG"; printf '\n[server.custom_static]\n%s\n' "$LINE"; } >"$WORK/config.new"
    fi
    cp "$WORK/config.new" "$CONFIG"
    say "Added '$LINE' to $CONFIG"
    echo ''
    echo 'Restart ActivityWatch once so it picks up the new page.'
  fi
  echo 'Open http://127.0.0.1:5600/pages/projects/ (Ctrl+F5 after updates).'
fi
