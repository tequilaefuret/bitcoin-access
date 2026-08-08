#!/bin/sh
set -eu

secret_file=".secrets/supabase_dev_admin_password"

if [ ! -r "$secret_file" ]; then
  printf 'Missing readable DEV database password: %s\n' "$secret_file" >&2
  exit 1
fi

SUPABASE_DB_PASSWORD="$(tr -d '\r\n' < "$secret_file")"
if [ -z "$SUPABASE_DB_PASSWORD" ]; then
  printf 'DEV database password is empty: %s\n' "$secret_file" >&2
  exit 1
fi

export SUPABASE_DB_PASSWORD
exec supabase db push "$@"
