#!/bin/sh
set -eu

target=${1:-}
case "$target" in
  development|production) ;;
  *)
    printf 'Usage: %s {development|production}\n' "$0" >&2
    exit 1
    ;;
esac

require_variable() {
  variable_name=$1
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    printf 'Missing required variable: %s\n' "$variable_name" >&2
    exit 1
  fi
}

for variable_name in \
  SUPABASE_ACCESS_TOKEN \
  SUPABASE_DB_PASSWORD \
  SUPABASE_PROJECT_REF \
  NETLIFY_AUTH_TOKEN \
  NETLIFY_SITE_ID \
  DEPLOYMENT_ENVIRONMENT \
  REACT_APP_SUPABASE_ANON_KEY \
  REACT_APP_WALLETCONNECT_PROJECT_ID \
  REACT_APP_TREZOR_MANIFEST_EMAIL \
  APP_URL
do
  require_variable "$variable_name"
done

[ "$DEPLOYMENT_ENVIRONMENT" = "$target" ] \
  || { printf 'Environment mismatch: expected %s, received %s.\n' "$target" "$DEPLOYMENT_ENVIRONMENT" >&2; exit 1; }

echo "$SUPABASE_PROJECT_REF" | grep -Eq '^[a-z0-9]{20}$' \
  || { printf 'Invalid SUPABASE_PROJECT_REF.\n' >&2; exit 1; }
echo "$NETLIFY_SITE_ID" | grep -Eq '^[A-Za-z0-9-]+$' \
  || { printf 'Invalid NETLIFY_SITE_ID.\n' >&2; exit 1; }
echo "$APP_URL" | grep -Eq '^https://[^/]+/?$' \
  || { printf 'APP_URL must be an HTTPS origin without a path.\n' >&2; exit 1; }

export REACT_APP_ENVIRONMENT="$target"
export REACT_APP_SUPABASE_URL="https://${SUPABASE_PROJECT_REF}.supabase.co"
export REACT_APP_AUTH_API_URL="${REACT_APP_AUTH_API_URL:-/api/auth}"

printf 'Validating %s release...\n' "$target"
sh scripts/validate-deployment-structure.sh
npm run test:ci
npm run build

printf 'Linking Supabase %s project...\n' "$target"
supabase link --project-ref "$SUPABASE_PROJECT_REF"

printf 'Reviewing pending database migrations...\n'
supabase db push --linked --dry-run

printf 'Applying pending database migrations...\n'
supabase db push --linked

printf 'Deploying all Edge Functions and pruning removed functions...\n'
supabase secrets set \
  --project-ref "$SUPABASE_PROJECT_REF" \
  AUTH_COOKIE_SECURE=true \
  AUTH_COOKIE_SAME_SITE=Lax
supabase functions deploy \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --use-api \
  --prune \
  --yes

printf 'Deploying the frontend to the %s Netlify site...\n' "$target"
netlify deploy \
  --dir build \
  --message "${target} ${GITHUB_SHA:-local}" \
  --prod

printf 'Running post-deployment smoke tests...\n'
sh scripts/smoke-test.sh

printf '%s deployment completed successfully.\n' "$target"
