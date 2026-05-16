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

node - "$ROOT" "$VERSION" <<'NODE'
const fs = require('fs');
const path = require('path');

const root = process.argv[2];
const version = process.argv[3];

const packageJsonPath = path.join(root, 'package.json');
const cargoTomlPath = path.join(root, 'src-tauri', 'Cargo.toml');
const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
packageJson.version = version;
fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

const cargoToml = fs.readFileSync(cargoTomlPath, 'utf8');
const updatedCargoToml = cargoToml.replace(/^version = ".*?"$/m, `version = "${version}"`);
if (updatedCargoToml === cargoToml) {
  throw new Error('Failed to update version in src-tauri/Cargo.toml');
}
fs.writeFileSync(cargoTomlPath, updatedCargoToml);

const tauriConfig = JSON.parse(fs.readFileSync(tauriConfigPath, 'utf8'));
if (tauriConfig.version !== '../package.json') {
  throw new Error(`Expected src-tauri/tauri.conf.json version to be '../package.json', got ${JSON.stringify(tauriConfig.version)}`);
}
NODE

echo "Bumped version to $VERSION"
