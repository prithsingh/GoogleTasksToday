#!/bin/sh
# Loads test/fixture.html in headless Chrome and prints the check results.
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
DIR="$(cd "$(dirname "$0")" && pwd)"
RESULT=$("$CHROME" --headless=new --disable-gpu --virtual-time-budget=5000 --dump-dom "file://$DIR/fixture.html" 2>/dev/null \
  | sed -n '/<pre id="result">/,/<\/pre>/p' | sed -e 's/<[^>]*>//g' -e 's/&quot;/"/g' -e 's/&amp;/\&/g')
echo "$RESULT"
[ -n "$RESULT" ] && ! echo "$RESULT" | grep -q FAIL
