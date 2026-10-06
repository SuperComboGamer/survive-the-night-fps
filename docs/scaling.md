# Running more than one game server

One process runs every game (see "Many games on one server" in ARCHITECTURE.md). This is how several game servers
run behind a small proxy of ours instead, how to set it up on a VM or on Railway, and what has been checked.

**Status (5 Oct 2026):** built, and checked end to end in the Railway environment `spike-replicas` (two game
replicas, the proxy, a Postgres): see "What was checked". Production runs one server, without it.

## One machine stays the default

None of this changes how a single server runs. `npm start` on a VM, a laptop or one Railway replica is the whole
game, as before:

- The proxy is optional. A game server without it serves the page, `/ws`, `/social` and the API itself.
- A game server only joins a cluster with `CLUSTER=1` and a Postgres `DATABASE_URL`. Without it nothing is
  registered, written or listened for: the lobby, presence and friends stay in memory, and a deploy hands the games
  to the next server as before (`game_handoff`, ARCHITECTURE.md "Deploys").
- Nothing in it is Railway's: a server's address comes from `CLUSTER_ADDR` or its network interfaces, so a VM can
  run the proxy and several game servers on one box, on localhost ports, all on one Postgres.

## How it works

Browsers reach only the proxy (`server/proxy/`). The game servers say where they are and what they hold in Postgres
(`server/cluster.js`, migration 011), and the proxy reads it every second.

- **`cluster_servers`**: a row per server (id, private address and port, deployment, games, players, capacity,
  draining), written every 2 s; one quiet for 10 s is not sent anything, one quiet for 60 s is swept with its rows.
- **`cluster_games`**: a row per running game (code, server, invite-only, what the lobby shows): where a code is, and
  the lobby of every server. A game's row is written when it is made, before `POST /api/games` answers, so the code
  works through the proxy at once.
- **`cluster_presence`**: per account and server, online or in which game, for friends on another server.
- **Across servers**: friend requests, accepts, messages, presence, sign-outs and perk picks go out as Postgres
  notifications on `stn_cluster` (under 8000 bytes each, as Postgres allows); the friends list asks
  `cluster_presence`.
- **The proxy** sends `/ws?game=CODE` and `GET /api/games/:code` to the game's server; a quick join to the fullest
  public game with a seat on any server, else the least busy server; `POST /api/games` to the least busy server of the
  newest deployment that is not draining; `GET /api/games` and `/status` it answers itself from every server; the rest
  (the page, `/social`, accounts, friends) to any server, in turn. It passes the WebSocket bytes through, following
  where frames begin and end, so on its own SIGTERM it ends every game socket between two frames with 4002
  (`MOVED_CODE`): the client's "Server updating" rejoin brings it back through the next proxy, into the body its game
  held (`Game.hold`). It sets `X-Forwarded-For`, which a game server believes from a private address only
  (`server/netaddr.js`, `TRUST_PROXY`). Every forwarded response says which server answered (`x-stn-server`); a
  request with `x-stn-via: <server id>` that would go to any server goes to that one (`scripts/verify-cluster.js`).
- **Deploys**: the old server, on SIGTERM, picks for each game with players the least busy server of the newest
  deployment and names it in the save (`game_handoff`) and in `cluster_games` before its sockets close with 4002. Only
  that server claims it (or any, if it is gone); meanwhile the proxy holds a rejoin for up to 6 s until the game is
  up again, so the player comes back without a "no such game".

### Settings

| Variable | Where | What |
|---|---|---|
| `CLUSTER=1` | game server | join the cluster (needs a Postgres `DATABASE_URL`) |
| `CLUSTER_ID` | game server | its id: else `RAILWAY_REPLICA_ID`, else `<hostname>:<port>` |
| `CLUSTER_ADDR` | game server | the address the proxy reaches it at: else Railway's private network (`railnet0`, IPv6), else the box's first IPv4 address |
| `CLUSTER_DEPLOYMENT` | game server | which deployment it is part of (the newest gets the new games): else `RAILWAY_DEPLOYMENT_ID`, else the build |
| `DATABASE_URL` | both | the same Postgres |
| `PORT` | both | game servers 3000, the proxy 8080 by default |

## On one VM

```sh
export DATABASE_URL=postgres://...
CLUSTER=1 CLUSTER_ID=a CLUSTER_ADDR=127.0.0.1 PORT=3001 npm start &
CLUSTER=1 CLUSTER_ID=b CLUSTER_ADDR=127.0.0.1 PORT=3002 npm start &
PORT=8080 npm run proxy        # the only port the world (or nginx / Caddy for TLS) reaches
```

A deploy: start the new servers with a new `CLUSTER_DEPLOYMENT` (and new ids), wait for them in
`/proxy/health`, then SIGTERM the old ones; their games move to the new ones. One server with no proxy needs none of
this: `npm start`.

## On Railway

```sh
railway link                                         # in this repo, once (any environment)
scripts/railway-cluster.sh <environment> [replicas=2] [region=us-east4-eqdc4a]
```

It adds what is missing (a Postgres, a `game` service, a `proxy` service), sets their variables (`DATABASE_URL` as a
reference, `CLUSTER=1`, ports, `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30`) and how
each starts, uploads the working tree to both, scales `game` and gives `proxy` a Railway domain, which it prints. Run
it again to deploy new code. It refuses `production` unless `YES_PRODUCTION=1`; moving a custom domain to the proxy
is by hand (and the `game` service then has no public domain at all).

What it works around, found setting it up:

- Railway CLI 5.x (`npx -y @railway/cli@latest`): 4.41 crashes on `railway scale`. `railway environment edit` only
  applied changes given as JSON on stdin (`--service-config` said "No changes to apply"), and `railway add` works on
  the linked environment only, so the script links a folder of its own.
- `numReplicas` in `railway.json` is not applied: the count is `railway scale`.
- Both services deploy the same repo and Railway puts `railway.json` over a service's settings, so the proxy's upload
  has `railway.proxy.json` as its `railway.json`, and both services' start commands are also set on the service. A
  proxy deployed from GitHub instead needs its config file set to `/railway.proxy.json` (Settings -> Config-as-code).
- The private network: a replica's `railnet0` has IPv4 and IPv6, but only IPv6 reached the game replicas from the
  proxy service (IPv4 timed out from it, though it worked from an older service), so a server registers its IPv6.
- `railway service list` says SUCCESS for the deployment serving, not the one building: the script waits on
  `railway deployment list`.

**Draining.** A server being replaced gets SIGTERM, then SIGKILL after the draining time, 0 s by default:
`RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` gives it time to hand its games over.

## Checking it

- `npm run test:cluster` (with `CLUSTER_TEST_DATABASE_URL`, a local Postgres it wipes): two servers and the proxy
  on this machine, then a deploy (a third server of a newer deployment, one of the first two stopped) and a restart of
  the proxy.
- `node scripts/verify-cluster.js https://<proxy domain>`: the same through a cluster that is up, from outside.
  `--hold [minutes]` keeps a player in a game while you redeploy the game servers or the proxy, and checks they come
  back in their own body each time. It makes accounts and games: not for production.

## What was checked

On `spike-replicas`, 5 Oct 2026: two `game` replicas, the proxy and a Postgres, from `scripts/railway-cluster.sh`.

| Checked | Result |
|---|---|
| Games made through the proxy | spread over both replicas; 18 of 18 joins by code reached their game; every invite card found on the replica it was made on; an unknown code is "no such game" |
| Quick join, lobby | 4 quick joins in one game; the lobby lists both replicas' public games |
| Friends on two replicas | request, accept and a message heard across; online, playing (and the game's code) and the end of it seen from the other replica; signing out on one closes the socket on the other |
| One game each | a second game asked for by the same account, or the same guest (whatever `X-Forwarded-For` they sent), refused with the code of the first, on either replica |
| Redeploying `game` with a player in | ended with 4002, back in their own body on a replica of the new deployment in 1.3 s |
| Redeploying `proxy` with a player in | ended with 4002, back through the new proxy in 0.35 s |
| The extra hop (spike) | HTTP p50 1.2-2.2 ms, p90 under 3.2 ms; a WebSocket opens in 1-5 ms |

## Limits over every server

- **One game each**: a player (account, or guest address) with a game going on any server cannot make another
  (409 with its code). `cluster_games.maker` (012) and `Cluster.reserve`, which checks it under an advisory lock.
- **The most games at once**: `server_settings.max_total_games` (`npm run setting -- max_total_games 50`), read by
  every server and the proxy every 5 s; `Cluster.reserve` counts the live games under the same lock, so it is never
  passed. Each server's `MAX_GAMES` still holds as well.
- Railway's edge sets `X-Forwarded-For` and `X-Real-IP` itself (a client's own were not passed on, checked 5 Oct
  2026), so a guest cannot pass for another address through it.

## Not done

- The other per-address allowances (3 games a minute, codes missed, sockets per address) are kept by each server, so
  with N servers an address gets N times them.
- One proxy replica. It keeps nothing of its own, so more should work, but that is not checked.
