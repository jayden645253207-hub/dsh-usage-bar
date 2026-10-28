#!/bin/sh
# Install dsh-usage-bar into a DSH profile.
#
#   ./install.sh                       # ~/.dsh/profiles/desktop
#   USAGE_BAR_PROFILE=/path ./install.sh
#
# The plugin is linked (not copied), so edits under this directory take effect
# on the next Harness start / page reload.
set -eu

SRC=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROFILE=${USAGE_BAR_PROFILE:-"$HOME/.dsh/profiles/desktop"}
PACKAGE="dsh-usage-bar"
PATCH_ID="local-usage-bar"
STAMP=$(date +%Y%m%d-%H%M%S)

if [ ! -f "$PROFILE/cordis.patch.yml" ]; then
  echo "error: $PROFILE/cordis.patch.yml not found — is USAGE_BAR_PROFILE correct?" >&2
  exit 1
fi

echo "profile : $PROFILE"
echo "source  : $SRC"

# 1. Back up the two files we touch.
cp "$PROFILE/cordis.patch.yml" "$PROFILE/cordis.patch.yml.bak-$STAMP"
cp "$PROFILE/package.json" "$PROFILE/package.json.bak-$STAMP"
echo "backup  : cordis.patch.yml.bak-$STAMP, package.json.bak-$STAMP"

# 2. Link the package into the profile's node_modules.
mkdir -p "$PROFILE/node_modules"
LINK="$PROFILE/node_modules/$PACKAGE"
if [ -L "$LINK" ]; then
  rm -f "$LINK"
elif [ -e "$LINK" ]; then
  echo "error: $LINK exists and is not a symlink — refusing to replace it" >&2
  exit 1
fi
ln -s "$SRC" "$LINK"
echo "link    : node_modules/$PACKAGE -> $SRC"

# 3. Record the dependency so a later `pnpm install` keeps the link.
SRC="$SRC" PROFILE="$PROFILE" PACKAGE="$PACKAGE" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.PROFILE + "/package.json";
const pkg = JSON.parse(readFileSync(file, "utf8"));
pkg.dependencies ??= {};
pkg.dependencies[process.env.PACKAGE] = "file:" + process.env.SRC;
writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log("dep     : " + process.env.PACKAGE + " => file:" + process.env.SRC);
'

# 4. Add the Cordis tree entry (idempotent).
if grep -q "id: $PATCH_ID" "$PROFILE/cordis.patch.yml"; then
  echo "patch   : $PATCH_ID already declared, left as is"
else
  case $(tail -c 1 "$PROFILE/cordis.patch.yml") in
    "") ;;
    *) printf '\n' >> "$PROFILE/cordis.patch.yml" ;;
  esac
  cat >> "$PROFILE/cordis.patch.yml" <<EOF
- insert: # $PATCH_ID
    - id: $PATCH_ID
      name: "$PACKAGE"
EOF
  echo "patch   : appended $PATCH_ID"
fi

echo
echo "Done. Reload the Harness window (or restart the app) to pick up the bar."
