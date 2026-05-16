#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
VERSION="${1:-}"

if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <semver>" >&2
  exit 1
fi

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must be semver in the form X.Y.Z" >&2
  exit 1
fi

python - "$ROOT/package.json" "$VERSION" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
version = sys.argv[2]
data = json.loads(path.read_text())
data["version"] = version
path.write_text(json.dumps(data, indent=2) + "\n")
PY

python - "$ROOT/src-tauri/Cargo.toml" "$VERSION" <<'PY'
import re
import sys
from pathlib import Path

path = Path(sys.argv[1])
version = sys.argv[2]
text = path.read_text()
new_text, count = re.subn(r'^version = ".*?"$', f'version = "{version}"', text, count=1, flags=re.MULTILINE)
if count != 1:
    raise SystemExit("Failed to update version in src-tauri/Cargo.toml")
path.write_text(new_text)
PY

python - "$ROOT/src-tauri/tauri.conf.json" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
data = json.loads(path.read_text())
expected = "../package.json"
actual = data.get("version")
if actual != expected:
    raise SystemExit(f"Expected src-tauri/tauri.conf.json version to be {expected!r}, got {actual!r}")
PY

echo "Bumped version to $VERSION"
