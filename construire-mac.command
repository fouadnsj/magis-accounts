#!/bin/zsh
# Double-click: checks first, then builds the Mac app (.app and .dmg).
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"
npx vitest run || { echo "Les vérifications échouent : pas de construction. · Checks failed: no build."; read; exit 1; }
npx tauri build --bundles app,dmg
open src-tauri/target/release/bundle/dmg
echo "Appuyez sur Entrée pour fermer · Press Enter to close"
read
