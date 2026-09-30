#!/usr/bin/env bash
# Copy actors/_shared into every Actor that uses it (has src/shared/). --check fails if any copy differs.
set -euo pipefail
cd "$(dirname "$0")"
bad=0
for d in */; do
  d=${d%/}; [ "$d" = _shared ] && continue
  [ -d "$d/src/shared" ] || continue
  for f in web.js kit.js html.js; do
    if [ "${1:-}" = --check ]; then cmp -s "_shared/$f" "$d/src/shared/$f" || { echo "out of date: $d/src/shared/$f"; bad=1; }
    else cp "_shared/$f" "$d/src/shared/$f"; fi
  done
  for t in web html; do
    if [ "${1:-}" = --check ]; then cmp -s "_shared/$t.test.mjs" "$d/tests/shared-$t.test.mjs" || { echo "out of date: $d/tests/shared-$t.test.mjs"; bad=1; }
    else cp "_shared/$t.test.mjs" "$d/tests/shared-$t.test.mjs"; fi
  done
done
exit $bad
