#!/bin/zsh
# Double-click: tries the Jesuit communities' accounts on THIS Mac, at every level.
# Three TEST databases (invented people, password test123 for everyone):
#   Homs (demo)      Sup-H (Superior) · Eco-H (econome + minister) · Jes-H1 · Jes-H2
#   Damascus (demo)  Sup-D (Superior + econome) · Min-D (minister) · Jes-D1
#   Syria (demo)     Eco-Syria (country econome)
# Test data live in ~/MAGIS-test-communities (never your real accounts).
# To start again from zero: delete that folder. Close this window to stop.
cd "$(dirname "$0")"
export PATH="$HOME/.local/node/bin:$PATH"
DATA="$HOME/MAGIS-test-communities"
mkdir -p "$DATA"

if [ ! -f server-dist/server.mjs ] || [ -n "$(find src server -newer server-dist/server.mjs -type f | head -1)" ]; then
  echo "Préparation du serveur… · Preparing the server…"
  npm run build:server >/dev/null 2>&1 || { echo "La préparation a échoué · Build failed"; read; exit 1; }
fi
npx esbuild server/demo-communities.ts --bundle --platform=node --format=esm --external:node:sqlite --outfile=server-dist/demo-communities.mjs --log-level=error \
  "--banner:js=import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  && node --no-warnings server-dist/demo-communities.mjs --data="$DATA" || { echo "Demo failed"; read; exit 1; }

IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null)
echo
echo "=============================================================="
echo "  Jesuit communities — TEST on this Mac"
echo "  On this Mac:             https://localhost:8443"
[ -n "$IP" ] && echo "  On a phone (same Wi-Fi): https://$IP:8443"
echo "  Password for everyone:   test123"
echo "  Test data:               $DATA"
echo "  To stop: close this window."
echo "=============================================================="
echo
(sleep 4; open "https://localhost:8443") &
node --no-warnings server-dist/server.mjs --data="$DATA"
