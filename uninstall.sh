#!/bin/sh
# Remove dsh-usage-bar from a DSH profile. Backups made by install.sh stay.
set -eu

PROFILE=${USAGE_BAR_PROFILE:-"$HOME/.dsh/profiles/desktop"}
PACKAGE="dsh-usage-bar"
PATCH_ID="local-usage-bar"
LINK="$PROFILE/node_modules/$PACKAGE"
PATCH="$PROFILE/cordis.patch.yml"

if [ ! -f "$PATCH" ]; then
  echo "error: $PATCH not found — is USAGE_BAR_PROFILE correct?" >&2
  exit 1
fi

STAMP=$(date +%Y%m%d-%H%M%S)
cp "$PATCH" "$PATCH.bak-$STAMP"
cp "$PROFILE/package.json" "$PROFILE/package.json.bak-$STAMP"

# 1. Drop the patch block: the two lines of the insert item plus its anchor.
if grep -q "id: $PATCH_ID" "$PATCH"; then
  PROFILE="$PROFILE" PATCH_ID="$PATCH_ID" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.PROFILE + "/cordis.patch.yml";
const id = process.env.PATCH_ID;
const lines = readFileSync(file, "utf8").split("\n");
const out = [];
let skipping = false;
for (const line of lines) {
  if (line.includes("insert: # " + id)) { skipping = true; continue; }
  if (skipping && line.includes("id: " + id)) continue;
  if (skipping && /^\s+name: "?dsh-usage-bar"?\s*$/.test(line)) { skipping = false; continue; }
  skipping = false;
  out.push(line);
}
writeFileSync(file, out.join("\n"));
'
  echo "patch   : removed $PATCH_ID"
else
  echo "patch   : $PATCH_ID not present, skipped"
fi

# 2. Remove the dependency entry.
PROFILE="$PROFILE" PACKAGE="$PACKAGE" node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const file = process.env.PROFILE + "/package.json";
const pkg = JSON.parse(readFileSync(file, "utf8"));
if (pkg.dependencies !== undefined) delete pkg.dependencies[process.env.PACKAGE];
writeFileSync(file, JSON.stringify(pkg, null, 2) + "\n");
console.log("dep     : removed " + process.env.PACKAGE);
'

# 3. Remove the link itself (never follows it).
if [ -L "$LINK" ]; then
  rm -f "$LINK"
  echo "link    : removed $LINK"
fi

echo
echo "Done. Restart the Harness app to drop the bar."
