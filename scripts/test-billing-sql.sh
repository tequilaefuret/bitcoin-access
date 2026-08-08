#!/bin/sh
set -eu

: "${TEST_DATABASE_URL:?TEST_DATABASE_URL is required}"

psql "$TEST_DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -P pager=off \
  -f scripts/test-fast-billing-local.sql
