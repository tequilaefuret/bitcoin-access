#!/bin/sh
set -eu

case "${1:-}" in
  verify)
    sql_file="scripts/verify-opinion-dev.sql"
    ;;
  test-quality)
    sql_file="scripts/test-opinion-quality-dev.sql"
    ;;
  test-trends)
    sql_file="scripts/test-opinion-trends-dev.sql"
    ;;
  test-discovery)
    sql_file="scripts/test-opinion-discovery-dev.sql"
    ;;
  *)
    printf 'Usage: %s {verify|test-quality|test-trends|test-discovery}\n' "$0" >&2
    exit 1
    ;;
esac

password_file=".secrets/supabase_dev_admin_password"
pooler_file="supabase/.temp/pooler-url"

if [ ! -r "$password_file" ] || [ ! -r "$pooler_file" ]; then
  printf 'Missing DEV database secret or Supabase pooler configuration.\n' >&2
  exit 1
fi

PGPASSWORD="$(tr -d '\r\n' < "$password_file")"
export PGPASSWORD

docker run --rm \
  --entrypoint psql \
  --env PGPASSWORD \
  --volume "$(pwd):/workspace:ro" \
  public.ecr.aws/supabase/postgres:17.6.1.011 \
  "$(cat "$pooler_file")" \
  -v ON_ERROR_STOP=1 \
  -P pager=off \
  -f "/workspace/$sql_file"

unset PGPASSWORD
