#!/usr/bin/env bash
# Verify migrations on a private disposable PostgreSQL before deploying.
set -euo pipefail
sha=${1:-}
[[ "$sha" =~ ^[a-f0-9]{40}$ && $(git rev-parse HEAD) == "$sha" ]]
name="zj-staging-proof-${GITHUB_RUN_ID:-$$}-${GITHUB_RUN_ATTEMPT:-1}"
network="${name}-net"
source_dir=$(mktemp -d)
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; rm -rf "$source_dir"; }
trap cleanup EXIT
git archive "$sha" apps/api/db/migrations apps/api/tsconfig.json tsconfig.base.json | tar -x -C "$source_dir"
docker network create "$network" >/dev/null
docker run -d --name "$name" --network "$network" -e POSTGRES_USER=proof -e POSTGRES_PASSWORD=proof -e POSTGRES_DB=proof postgres:16-alpine >/dev/null
for _ in $(seq 1 60); do
  docker exec "$name" pg_isready -h 127.0.0.1 -U proof -d proof >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$name" pg_isready -h 127.0.0.1 -U proof -d proof >/dev/null
docker run --rm --network "$network" --read-only -e DATABASE_URL="postgresql://proof:proof@$name:5432/proof" \
  -e NODE_PATH=/repo/node_modules -e TS_NODE_PROJECT=/source/apps/api/tsconfig.json -e TS_NODE_TRANSPILE_ONLY=1 \
  -v "$source_dir:/source:ro" -w /source/apps/api "zenithjoy-api-staging:$sha" \
  node -r /repo/node_modules/ts-node/register/transpile-only /source/apps/api/db/migrations/run-migration.ts
count=$(docker exec "$name" psql -U proof -d proof -Atc 'SELECT count(*) FROM zenithjoy.schema_migrations')
[[ "$count" =~ ^[0-9]+$ && "$count" -gt 0 ]]
echo "Isolated candidate migration completed; $count migrations recorded"
