#!/usr/bin/env bash
# Ship Actors one after another: README check, unit tests, push + build, pricing/Store details,
# a real test run on Apify, and (PUBLIC=true) publish. Writes $OUT/<actor>.md per Actor.
# Stops publishing for the day when Apify reports its daily publication limit.
# Needs APIFY_TOKEN; the Apify CLI must already be logged in.
set -u
OUT=${OUT:-ship-reports}; mkdir -p "$OUT"
root=$(cd "$(dirname "$0")/.." && pwd)
failed=0; limit_hit=0
for a in "$@"; do
  rep="$OUT/$a.md"
  pub=$PUBLIC; [ "$limit_hit" = 1 ] && pub=false
  (
    cd "$root"
    echo "# ship $a $(date -u +%FT%TZ) ${GITHUB_SHA:-local}"
    if ! [[ "$a" =~ ^[a-z0-9-]+$ ]] || [ ! -f "actors/$a/.actor/actor.json" ]; then echo "No Actor folder actors/$a"; exit 1; fi
    cd "actors/$a"
    [ -s README.md ] || { echo "README.md missing (it is the Store listing)"; exit 1; }
    echo '## unit tests'; echo '```'
    npm install --no-audit --no-fund >/dev/null 2>&1
    npm test 2>&1 | grep -E '^# (tests|pass|fail)|^not ok'; test_ok=${PIPESTATUS[0]}
    echo '```'
    [ "$test_ok" = 0 ] || { echo "Unit tests failed"; exit 1; }
    rm -rf node_modules storage
    echo '## push'; echo '```'
    npx --yes apify-cli@latest push --force > /tmp/push-$a.log 2>&1
    grep -vE '^[0-9TZ:.-]+ #' /tmp/push-$a.log | tail -n 12 | sed 's/apify_api_[A-Za-z0-9]*/***/g'
    echo '```'
    grep -q "Build: SUCCEEDED" /tmp/push-$a.log || { echo "Build failed"; exit 1; }
    cd "$root"
    echo '## Apify setup and test run'; echo '```'
    PUBLIC=$pub python3 actors/ship.py "$a" 2>&1 | sed 's/apify_api_[A-Za-z0-9]*/***/g'; st=${PIPESTATUS[0]}
    echo '```'
    exit $st
  ) > "$rep" 2>&1 || { failed=1; echo "::warning::ship problem for $a (see $rep)"; }
  grep -q "daily-publication-limit" "$rep" && limit_hit=1
  echo "done $a (limit reached: $limit_hit)"
done
exit $failed
