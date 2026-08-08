#!/bin/sh
set -eu

if [ "$(id -u)" -eq 0 ]; then
  if [ -n "${DATABASE_URL_FILE:-}" ] && [ -f "$DATABASE_URL_FILE" ]; then
    DATABASE_URL="$(cat "$DATABASE_URL_FILE")"
    export DATABASE_URL
    DATABASE_URL_FILE=""
    export DATABASE_URL_FILE
  fi

  exec gosu worker "$@"
fi

exec "$@"
