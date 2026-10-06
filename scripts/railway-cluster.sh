#!/usr/bin/env bash
# Sets up, or redeploys, Survive The Night on Railway as several game servers behind the proxy (docs/scaling.md):
# a Postgres, the game service on N replicas with CLUSTER=1 and the proxy service with the public domain. Run it again
# to deploy new code: what is there already is kept.
#
#   scripts/railway-cluster.sh <environment> [replicas=2] [region=us-east4-eqdc4a]
#
# Run from a folder linked to the Railway project (`railway link`), or set RAILWAY_PROJECT to its id. The services
# are `game`, `proxy` and the first Postgres in the environment, unless GAME_SERVICE, PROXY_SERVICE or DB_SERVICE
# say otherwise. It deploys the working tree as it is, uncommitted changes and all. One server with no proxy (a VM,
# `npm start`) needs none of this.
set -euo pipefail

ENV=${1:?usage: scripts/railway-cluster.sh <environment> [replicas] [region]}
N=${2:-2}
REGION=${3:-us-east4-eqdc4a}
GAME=${GAME_SERVICE:-game}
PROXY=${PROXY_SERVICE:-proxy}
REPO=$(cd "$(dirname "$0")/.." && pwd)

rw() { npx -y @railway/cli@latest "$@"; }
json() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let j;try{j=JSON.parse(s)}catch{process.exit(1)}console.log(eval(process.argv[1])??"")})' "$1"; }

PROJECT=${RAILWAY_PROJECT:-$(rw status --json 2>/dev/null | json 'j.id')}
[ -n "$PROJECT" ] || { echo "no Railway project: run \`railway link\` here first, or set RAILWAY_PROJECT" >&2; exit 1; }
[ "$ENV" = production ] && [ "${YES_PRODUCTION:-}" != 1 ] && { echo "this is production: set YES_PRODUCTION=1 to go on" >&2; exit 1; }

# `railway add` works on the linked environment only, so the work is done in a folder of its own linked to $ENV
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir "$WORK/link"
cd "$WORK/link"
rw link -p "$PROJECT" -e "$ENV" >/dev/null
echo "project $PROJECT, environment $ENV"

services() {
  local out
  for _ in 1 2 3 4 5; do
    out=$(rw service list --json 2>/dev/null || true)
    case "$out" in \[*) echo "$out"; return 0 ;; esac
    sleep 3
  done
  echo "railway service list did not answer" >&2
  return 1
}
has() { services | json "j.some(s => s.name === '$1') ? 1 : ''"; }

DB=${DB_SERVICE:-$(services | json "j.find(s => /postgres/i.test(s.source?.image || '') || /^postgres/i.test(s.name))?.name")}
if [ -z "$DB" ]; then
  DB=$(rw add -d postgres --json | tail -1 | json 'j.serviceName')
  echo "added the database: $DB"
fi
echo "database: $DB"
[ -n "$(has "$GAME")" ] || { rw add -s "$GAME" >/dev/null; echo "added the service $GAME"; }
[ -n "$(has "$PROXY")" ] || { rw add -s "$PROXY" >/dev/null; echo "added the service $PROXY"; }

DBURL="DATABASE_URL=\${{$DB.DATABASE_URL}}"
rw variable set "$DBURL" CLUSTER=1 PORT=3000 RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30 -s "$GAME" -e "$ENV" --skip-deploys >/dev/null
rw variable set "$DBURL" PORT=8080 RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30 -s "$PROXY" -e "$ENV" --skip-deploys >/dev/null
if [ -z "$(rw variable list -s "$GAME" -e "$ENV" --json 2>/dev/null | json 'j.ADMIN_SECRET')" ]; then
  rw variable set "ADMIN_SECRET=$(openssl rand -hex 24)" -s "$GAME" -e "$ENV" --skip-deploys >/dev/null
fi

# how each service starts: set on the service itself (a `railway up` of a folder was not seen to apply its railway.json,
# and the two services share one repo: a GitHub-linked proxy needs its config file set to /railway.proxy.json instead)
GAME_ID=$(services | json "j.find(s => s.name === '$GAME').id")
PROXY_ID=$(services | json "j.find(s => s.name === '$PROXY').id")
cat <<EOF | rw environment edit -e "$ENV" -m "cluster: how $GAME and $PROXY start" --json >/dev/null
{"services": {
  "$GAME_ID": {"build": {"buildCommand": "npm run build"},
    "deploy": {"startCommand": "npm start", "healthcheckPath": "/status", "healthcheckTimeout": 120}},
  "$PROXY_ID": {"build": {"buildCommand": "echo proxy: no client build"},
    "deploy": {"startCommand": "npm run proxy", "healthcheckPath": "/proxy/health", "healthcheckTimeout": 60}}
}}
EOF

# what is uploaded: the repo as it is, without what .gitignore leaves out; the proxy's copy has its own railway.json
# (in case Railway does apply it: it goes over the service's settings)
mkdir "$WORK/game"
(cd "$REPO" && git ls-files -co --exclude-standard -z | rsync -a --from0 --files-from=- . "$WORK/game/")
cp -R "$WORK/game" "$WORK/proxy"
cp "$REPO/railway.proxy.json" "$WORK/proxy/railway.json"

# wait for the newest deployment of a service to be up (or say why not)
up() {
  local svc=$1 at=$2 status=""
  for _ in $(seq 1 120); do
    status=$(rw deployment list -s "$svc" -e "$ENV" --limit 5 --json 2>/dev/null | json "j.filter(d => new Date(d.createdAt) >= new Date('$at'))[0]?.status" || true)
    case "$status" in
      SUCCESS) echo "$svc is up"; return 0 ;;
      FAILED|CRASHED|REMOVED) echo "$svc: $status, see: railway logs -s $svc -e $ENV" >&2; return 1 ;;
    esac
    sleep 5
  done
  echo "$svc: still ${status:-not started} after 10 min" >&2
  return 1
}

# the game servers first: their deploy runs the migrations the proxy reads
AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rw up "$WORK/game" --path-as-root -s "$GAME" -e "$ENV" -d >/dev/null
rw scale -s "$GAME" -e "$ENV" "$REGION=$N" >/dev/null
echo "deploying $GAME on $N replicas..."
up "$GAME" "$AT"

AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
rw up "$WORK/proxy" --path-as-root -s "$PROXY" -e "$ENV" -d >/dev/null
echo "deploying $PROXY..."
up "$PROXY" "$AT"

DOMAIN=$(services | json "j.find(s => s.name === '$PROXY')?.url || ''")
[ -n "$DOMAIN" ] || DOMAIN=$(rw domain -s "$PROXY" -e "$ENV" -p 8080 --json 2>/dev/null | json 'j.domain || j.domains?.[0] || ""')
[ -n "$DOMAIN" ] || DOMAIN="<the domain of $PROXY: railway domain -s $PROXY -e $ENV -p 8080>"
echo
echo "the game is at $DOMAIN"
GAMEURL=$(services | json "j.find(s => s.name === '$GAME')?.url || ''")
[ -z "$GAMEURL" ] || echo "the $GAME service still has a public domain ($GAMEURL): move it to $PROXY, or players reach one replica at random"
echo "check it: curl -s $DOMAIN/proxy/health; curl -s $DOMAIN/status"
