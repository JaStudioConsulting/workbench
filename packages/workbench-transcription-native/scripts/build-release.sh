#!/usr/bin/env bash
set -euo pipefail

package_dir=$(cd "$(dirname "$0")/.." && pwd)
swift build \
  --package-path "$package_dir" \
  --configuration release \
  --product workbench-transcribe

swift build \
  --package-path "$package_dir" \
  --configuration release \
  --show-bin-path
