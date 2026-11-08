#!/usr/bin/env bash
set -euo pipefail

package_dir=$(cd "$(dirname "$0")/.." && pwd)
repo_dir=$(cd "$package_dir/../.." && pwd)
install_dir=${WORKBENCH_NATIVE_BIN_DIR:-"$repo_dir/native/bin"}
swift build \
  --package-path "$package_dir" \
  --configuration release \
  --product workbench-transcribe

build_dir=$(swift build \
  --package-path "$package_dir" \
  --configuration release \
  --show-bin-path)

mkdir -p "$install_dir"
install -m 755 "$build_dir/workbench-transcribe" "$install_dir/workbench-transcribe"
printf '%s\n' "$install_dir/workbench-transcribe"
