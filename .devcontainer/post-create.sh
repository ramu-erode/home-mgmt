#!/usr/bin/env bash
set -uo pipefail
cd /home-mgmt

bash .devcontainer/verify-mounts.sh || echo "(continuing despite mount warnings)"

echo "== node =="
node -e '
const [maj,min,pat]=process.versions.node.split(".").map(Number);
const ok = (maj===22 && (min>22 || (min===22&&pat>=3))) || (maj===24 && min>=15) || maj>=26;
console.log("node", process.versions.node, ok ? "ok" : "TOO OLD for @angular-devkit");
if(!ok) console.log("  rebuild the container - Dockerfile pins NODE_VERSION");
'

if [ -f package.json ]; then
  echo "== npm ci =="
  npm ci || npm install
else
  echo "== no package.json yet — skipping install =="
fi

echo "== claude code =="
if command -v claude >/dev/null 2>&1; then
  echo "claude $(claude --version 2>/dev/null || echo '(version unavailable)')"
else
  echo "claude NOT on PATH - check the devcontainer feature installed"
fi

echo "== database =="
if pg_isready -q; then
  psql -tAc "select extname from pg_extension order by 1" | tr '\n' ' '; echo
else
  echo "db not reachable (check .devcontainer/.env)"
fi
