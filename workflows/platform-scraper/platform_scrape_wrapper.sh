#!/bin/bash
# Wrapper script that runs scraper and outputs JSON result
# Usage: ./platform_scrape_wrapper.sh <platform>

PLATFORM=$1

if [ -z "$PLATFORM" ]; then
  echo '{"success": false, "error": "Platform not specified"}'
  exit 1
fi

# Get container IP
CONTAINER_NAME="novnc-${PLATFORM}"
CONTAINER_IP=$(docker inspect $CONTAINER_NAME --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)

if [ -z "$CONTAINER_IP" ]; then
  echo "{\"success\": false, \"error\": \"Container not found: $CONTAINER_NAME\"}"
  exit 1
fi

# Run scraping script
SCRIPT_FILE="$HOME/platform_scrape_${PLATFORM}_v3.js"

if [ ! -f "$SCRIPT_FILE" ]; then
  SCRIPT_FILE="$HOME/platform_scrape_${PLATFORM}.js"
fi

if [ ! -f "$SCRIPT_FILE" ]; then
  echo "{\"success\": false, \"error\": \"Script not found for platform: $PLATFORM\"}"
  exit 1
fi

# Run script and capture output
OUTPUT=$(node "$SCRIPT_FILE" "$CONTAINER_IP" 2>&1)
EXIT_CODE=$?

# Check if successful
if [ $EXIT_CODE -eq 0 ] && echo "$OUTPUT" | grep -q "completed successfully"; then
  # Extract counts from output
  INSERTED=$(echo "$OUTPUT" | grep -oP 'Inserted: \K\d+' | tail -1)
  UPDATED=$(echo "$OUTPUT" | grep -oP 'Updated: \K\d+' | tail -1)
  TOTAL=$(echo "$OUTPUT" | grep -oP 'Total: \K\d+' | tail -1)
  
  echo "{\"success\": true, \"platform\": \"$PLATFORM\", \"inserted\": ${INSERTED:-0}, \"updated\": ${UPDATED:-0}, \"total\": ${TOTAL:-0}, \"needLogin\": false}"
elif echo "$OUTPUT" | grep -q "Session expired"; then
  echo "{\"success\": false, \"platform\": \"$PLATFORM\", \"needLogin\": true, \"error\": \"Session expired\"}"
else
  ERROR=$(echo "$OUTPUT" | tail -5 | tr '"' "'")
  echo "{\"success\": false, \"platform\": \"$PLATFORM\", \"needLogin\": false, \"error\": \"$ERROR\"}"
fi
