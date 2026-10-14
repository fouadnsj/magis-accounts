#!/bin/zsh
# Double-click: runs every check, including the juge against Master Sup.xlsx.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$HOME/.cargo/bin:$PATH"
npx vitest run 2>&1 | grep -v -i "experimental\|trace-warnings"
echo
echo "Appuyez sur Entrée pour fermer · Press Enter to close"
read
