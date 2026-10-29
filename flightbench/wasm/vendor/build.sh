#!/usr/bin/env bash
# Build local assets only. Requires an activated Emscripten 4.0.18 SDK and CMake.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT"
command -v emcmake >/dev/null
command -v em++ >/dev/null
em++ --version | head -1 | grep -F '4.0.18' >/dev/null || { echo 'Use Emscripten 4.0.18'; exit 1; }
mkdir -p scratch frontend/public/wasm/vendor
ARCHIVE=scratch/jsbsim-1.3.1.tar.gz
if [ ! -f "$ARCHIVE" ]; then
  curl --fail --location --proto '=https' --tlsv1.2 \
    https://codeload.github.com/JSBSim-Team/jsbsim/tar.gz/refs/tags/v1.3.1 -o "$ARCHIVE"
fi
python3 - <<'PY'
import hashlib, tarfile
from pathlib import Path
archive = Path('scratch/jsbsim-1.3.1.tar.gz')
assert hashlib.sha256(archive.read_bytes()).hexdigest() == '3ade625a388a1f48f6de7eaaaa8b680e8fed2e29550b669b490735ea88cc81e8'
if not Path('scratch/jsbsim-1.3.1').exists():
    with tarfile.open(archive) as tar:
        tar.extractall('scratch', filter='data')
PY
if patch --dry-run --silent --forward -d scratch/jsbsim-1.3.1 -p1 < examples/wasm/emscripten.patch; then
  patch --silent --forward -d scratch/jsbsim-1.3.1 -p1 < examples/wasm/emscripten.patch
else
  patch --dry-run --silent --reverse -d scratch/jsbsim-1.3.1 -p1 < examples/wasm/emscripten.patch
fi
emcmake cmake -S examples/wasm -B scratch/wasm-build \
  -DJSBSIM_SOURCE="$ROOT/scratch/jsbsim-1.3.1" -DCMAKE_BUILD_TYPE=Release
cmake --build scratch/wasm-build --target jsbsim_wasm -j 4
cp scratch/wasm-build/jsbsim_wasm.{mjs,wasm} frontend/public/wasm/vendor/
# Ship original source + the sole portability patch + relink instructions with the binary.
cp "$ARCHIVE" frontend/public/wasm/vendor/jsbsim-source.tar.gz
cp LICENSE frontend/public/wasm/vendor/FLIGHTBENCH-LICENSE.txt
cp scratch/jsbsim-1.3.1/COPYING frontend/public/wasm/vendor/JSBSIM-COPYING.txt
cp examples/wasm/{bindings.cpp,CMakeLists.txt,emscripten.patch,build.sh} frontend/public/wasm/vendor/
