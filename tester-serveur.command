#!/bin/zsh
# Double-click: runs the centre's server on THIS Mac, to try it before the mini-PC.
# Test data live in ~/MAGIS-test-server (never your real accounts file).
# Close this window (or press Ctrl+C) to stop the server.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
DATA="$HOME/MAGIS-test-server"
mkdir -p "$DATA"

if [ ! -f server-dist/server.mjs ] || [ -n "$(find src server -newer server-dist/server.mjs -type f | head -1)" ]; then
  echo "Préparation du serveur… · Preparing the server…"
  npm run build:server >/dev/null 2>&1 || { echo "La préparation a échoué · Build failed"; read; exit 1; }
fi

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo
echo "=============================================================="
echo "  MAGIS server — TEST on this Mac"
echo "  On this Mac:            https://localhost:8443"
[ -n "$IP" ] && echo "  On a phone (same Wi-Fi): https://$IP:8443"
echo "  Test data:              $DATA"
echo "  To stop: close this window."
echo "=============================================================="
echo
(sleep 4; open "https://localhost:8443") &
node --no-warnings server-dist/server.mjs --data="$DATA"
