#!/usr/bin/env bash
# Match the source server exactly: newer pg_dump emits settings older restore servers reject.
select_pg_dump() {
  local version major candidate reported
  local client_root="${2:-/usr/lib/postgresql}"
  version="$(psql "$1" -X -tAq -v ON_ERROR_STOP=1 -c 'SHOW server_version_num')" || return 1
  if [[ ! "$version" =~ ^[0-9]{6}$ ]]; then
    echo 'PG_SERVER_VERSION_INVALID' >&2
    return 1
  fi
  major="$((10#$version / 10000))"
  # Ubuntu PostgreSQL packages install version-specific binaries here, even when
  # /usr/bin/pg_dump's pg_wrapper selects the newest installed major.
  for candidate in "$client_root/$major/bin/pg_dump" "pg_dump-$major" pg_dump; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    reported="$("$candidate" --version)" || continue
    if [[ "$reported" =~ PostgreSQL\)\ ([0-9]+)\. ]] && [[ "${BASH_REMATCH[1]}" == "$major" ]]; then
      PG_DUMP="$(command -v "$candidate")"
      PG_SERVER_MAJOR="$major"
      return 0
    fi
  done
  echo "PG_DUMP_MAJOR_UNAVAILABLE: require PostgreSQL $major client" >&2
  return 1
}

# Custom-format archives require a matching pg_restore too; never infer it from PATH.
select_pg_restore() {
  local candidate reported
  local client_root="${1:-/usr/lib/postgresql}"
  [[ "${PG_SERVER_MAJOR:-}" =~ ^[0-9]+$ ]] || return 1
  for candidate in "$client_root/$PG_SERVER_MAJOR/bin/pg_restore" "pg_restore-$PG_SERVER_MAJOR" pg_restore; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    reported="$("$candidate" --version)" || continue
    if [[ "$reported" =~ PostgreSQL\)\ ([0-9]+)\. ]] && [[ "${BASH_REMATCH[1]}" == "$PG_SERVER_MAJOR" ]]; then
      PG_RESTORE="$(command -v "$candidate")"
      return 0
    fi
  done
  echo "PG_RESTORE_MAJOR_UNAVAILABLE: require PostgreSQL $PG_SERVER_MAJOR client" >&2
  return 1
}
