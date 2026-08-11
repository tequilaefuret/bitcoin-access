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

search_frontend() {
  pattern=$1
  case_sensitive=${2:-true}

  if command -v rg >/dev/null 2>&1; then
    if [ "$case_sensitive" = 'true' ]; then
      rg -n "$pattern" src -g '!**/*.test.*'
    else
      rg -n -i "$pattern" src -g '!**/*.test.*'
    fi
  elif [ "$case_sensitive" = 'true' ]; then
    grep -RInE --exclude='*.test.*' "$pattern" src
  else
    grep -RInEi --exclude='*.test.*' "$pattern" src
  fi
}

if search_frontend 'isTestMode|danaus_demo|test_balance|Preview without wallet' false; then
  fail 'demo-mode code found in the production frontend'
fi

if search_frontend 'console\.(log|debug|info|warn|error)'; then
  fail 'browser console logging found'
fi

printf 'Deployment structure valid: %s migrations, %s Edge Functions.\n' \
  "$migration_count" "$function_count"
