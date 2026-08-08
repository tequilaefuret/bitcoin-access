#!/bin/sh
set -eu

fail() {
  printf 'Deployment structure error: %s\n' "$1" >&2
  exit 1
}

migration_count=0
timestamps=''
for migration in supabase/migrations/*.sql; do
  [ -f "$migration" ] || continue
  migration_count=$((migration_count + 1))
  filename=${migration##*/}
  echo "$filename" | grep -Eq '^[0-9]{12,14}_[a-z0-9_]+\.sql$' \
    || fail "invalid migration filename: $filename"
  timestamp=${filename%%_*}
  case " $timestamps " in
    *" $timestamp "*) fail "duplicate migration timestamp: $timestamp" ;;
  esac
  timestamps="$timestamps $timestamp"
done
[ "$migration_count" -gt 0 ] || fail 'no SQL migration found'

function_count=0
for function_dir in supabase/functions/*; do
  [ -d "$function_dir" ] || continue
  [ "${function_dir##*/}" = '_shared' ] && continue
  [ -f "$function_dir/index.ts" ] \
    || fail "Edge Function without index.ts: $function_dir"
  function_count=$((function_count + 1))
done
[ "$function_count" -gt 0 ] || fail 'no Edge Function found'

for removed_function in social-like verify-bitcoin-signature; do
  [ ! -e "supabase/functions/$removed_function/index.ts" ] \
    || fail "obsolete Edge Function restored: $removed_function"
done

if rg -n -i 'isTestMode|danaus_demo|test_balance|Preview without wallet' src \
  -g '!**/*.test.*'; then
  fail 'demo-mode code found in the production frontend'
fi

if rg -n 'console\.(log|debug|info|warn|error)' src -g '!**/*.test.*'; then
  fail 'browser console logging found'
fi

printf 'Deployment structure valid: %s migrations, %s Edge Functions.\n' \
  "$migration_count" "$function_count"
