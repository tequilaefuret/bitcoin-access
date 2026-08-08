#!/bin/sh
set -eu

: "${APP_URL:?APP_URL is required}"
: "${REACT_APP_SUPABASE_URL:?REACT_APP_SUPABASE_URL is required}"
: "${REACT_APP_SUPABASE_ANON_KEY:?REACT_APP_SUPABASE_ANON_KEY is required}"

app_origin=${APP_URL%/}

curl --fail --silent --show-error \
  --retry 5 --retry-delay 3 --retry-all-errors \
  "$app_origin" >/dev/null

curl --fail --silent --show-error \
  --retry 5 --retry-delay 3 --retry-all-errors \
  --request OPTIONS \
  --header "Origin: $app_origin" \
  --header 'Access-Control-Request-Method: POST' \
  --header "apikey: $REACT_APP_SUPABASE_ANON_KEY" \
  "$REACT_APP_SUPABASE_URL/functions/v1/auth-session" >/dev/null

printf 'Smoke tests passed for %s.\n' "$app_origin"
