#!/bin/bash
# VentureForge auto-sync: watches for changes, debounces, then git add/commit/push.
# Designed to be run by launchd as a persistent daemon.

REPO="/Users/jonathanrouwhorst/ventureforge"
DEBOUNCE=30  # seconds to wait after last change before committing
LOGFILE="/tmp/ventureforge-autosync.log"

cd "$REPO" || exit 1

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOGFILE"; }

log "autosync started"

# Ensure we have a remote
if ! git remote get-url origin &>/dev/null; then
    log "no remote configured, exiting"
    exit 1
fi

last_change=0

while true; do
    # Wait for filesystem changes (blocks until something changes)
    fswatch --one-event --latency=5 \
        --exclude '\.git' \
        --exclude '__pycache__' \
        --exclude '\.venv' \
        --exclude '\.db$' \
        --exclude '\.db-' \
        --exclude 'outputs/' \
        "$REPO" 2>/dev/null

    # Debounce: wait DEBOUNCE seconds, reset if more changes come
    sleep "$DEBOUNCE"

    # Check if there are actual changes to commit
    if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
        continue
    fi

    # Stage, commit, push
    git add -A
    CHANGED=$(git diff --cached --stat | tail -1)
    if [ -z "$CHANGED" ]; then
        continue
    fi

    TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    git commit -m "auto: $TIMESTAMP

$CHANGED" 2>> "$LOGFILE"

    if git push origin main 2>> "$LOGFILE"; then
        log "pushed: $CHANGED"
    else
        log "push failed, will retry next cycle"
    fi
done
