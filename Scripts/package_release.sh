#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/go/bin:${PATH}"

DEFAULT_VER="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION" 2>/dev/null || echo "1.0.0")"
VERSION="${1:-${DEFAULT_VER}}"

"${SCRIPT_DIR}/build_binaries.sh" "${VERSION}"

BIN_DIR="${ROOT_DIR}/dist/bin"
APP_BUNDLE="${ROOT_DIR}/dist/Dicebound.app"
RELEASE_DIR="${ROOT_DIR}/dist/release"
DMG_STAGE="/tmp/DiceboundDMGStage"
WIN_STAGE="/tmp/DiceboundWinStage"

rm -rf "${RELEASE_DIR}" "${DMG_STAGE}" "${WIN_STAGE}"
mkdir -p "${RELEASE_DIR}" "${DMG_STAGE}" "${WIN_STAGE}"

# 1. Direct standalone binaries
cp "${BIN_DIR}/dicebound-windows-amd64.exe" "${RELEASE_DIR}/dicebound-windows-amd64.exe"
cp "${BIN_DIR}/dicebound-mac-arm64" "${RELEASE_DIR}/dicebound-mac-arm64"
cp "${BIN_DIR}/dicebound-mac-amd64" "${RELEASE_DIR}/dicebound-mac-amd64"

# 2. Windows ZIP bundle (exe + README + LICENSE)
cp "${BIN_DIR}/dicebound-windows-amd64.exe" "${WIN_STAGE}/dicebound.exe"
cp "${ROOT_DIR}/README.md" "${WIN_STAGE}/README.md"
cp "${ROOT_DIR}/LICENSE" "${WIN_STAGE}/LICENSE"
WIN_ZIP="Dicebound-${VERSION}-windows-amd64.zip"
(cd "${WIN_STAGE}" && zip -q -r "${RELEASE_DIR}/${WIN_ZIP}" .)

# 3. macOS .app.zip & .dmg (when running on macOS)
MAC_APP_ZIP="Dicebound-${VERSION}-macOS.app.zip"
MAC_DMG="Dicebound-${VERSION}-macOS.dmg"
if [[ "$(uname -s)" == "Darwin" ]]; then
    ditto -c -k --norsrc --noextattr --keepParent "${APP_BUNDLE}" "${RELEASE_DIR}/${MAC_APP_ZIP}"

    ditto --norsrc --noextattr "${APP_BUNDLE}" "${DMG_STAGE}/Dicebound.app"
    ln -s /Applications "${DMG_STAGE}/Applications"
    if [[ -f "${APP_BUNDLE}/Contents/Resources/AppIcon.icns" ]]; then
        cp "${APP_BUNDLE}/Contents/Resources/AppIcon.icns" "${DMG_STAGE}/.VolumeIcon.icns"
    fi
    hdiutil create \
        -volname "Dicebound" \
        -srcfolder "${DMG_STAGE}" \
        -ov \
        -format UDZO \
        "${RELEASE_DIR}/${MAC_DMG}"
fi

rm -rf "${DMG_STAGE}" "${WIN_STAGE}"

(
    cd "${RELEASE_DIR}"
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 * > SHA256SUMS.txt
    else
        sha256sum * > SHA256SUMS.txt
    fi
)

echo "Release artifacts ready in ${RELEASE_DIR}:"
cat "${RELEASE_DIR}/SHA256SUMS.txt"
