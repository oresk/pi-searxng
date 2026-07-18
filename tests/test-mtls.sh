#!/usr/bin/env bash
# Test the pi-searxng mTLS setup against SEARXNG_URL
# Runs two checks:
#   1. curl  — ground truth: sends the client cert correctly.
#   2. node  — runs the actual searxng.ts extension via the harness.
set -uo pipefail

SEARXNG_CERT=${SEARXNG_CERT:-}
SEARXNG_KEY=${SEARXNG_KEY:-}
SEARXNG_CA=${SEARXNG_CA:-}

QUERY="${1:-hello world}"

echo "════════════════════════════════════════════════════════════"
echo " 1) curl (ground truth — definitely sends client cert)"
echo "════════════════════════════════════════════════════════════"
curl_args=(--cert "$SEARXNG_CERT" --key "$SEARXNG_KEY")
if [ -n "$SEARXNG_CA" ]; then
	curl_args+=(--cacert "$SEARXNG_CA")
fi
curl -sS "${curl_args[@]}" \
  -w "\n[curl] HTTP %{http_code}\n" \
  "$SEARXNG_URL/search?q=$(printf '%s' "$QUERY" | sed 's/ /+/g')&format=json&categories=general&safesearch=0" \
  | head -30

echo
echo "════════════════════════════════════════════════════════════"
echo " 2) node — the real searxng.ts extension via harness"
echo "════════════════════════════════════════════════════════════"
node "$(dirname "$0")/run-extension.mts" "$QUERY"
