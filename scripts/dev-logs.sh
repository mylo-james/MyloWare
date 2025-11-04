#!/bin/bash

# Parse arguments
SERVICE=""
FOLLOW=""

while [[ $# -gt 0 ]]; do
  case $1 in
    -f|--follow)
      FOLLOW="-f"
      shift
      ;;
    postgres|n8n|n8n-postgres|cloudflared|server)
      SERVICE="$1"
      shift
      ;;
    *)
      echo "Usage: $0 [-f] [service]"
      echo "Services: postgres, n8n, n8n-postgres, cloudflared, server"
      exit 1
      ;;
  esac
done

if [ "$SERVICE" = "server" ]; then
  # Show MCP server logs
  echo "📋 MCP Server Logs:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  if [ -f logs/dev-server.log ]; then
    if [ -n "$FOLLOW" ]; then
      tail -f logs/dev-server.log
    else
      tail -n 50 logs/dev-server.log
    fi
  else
    echo "No server logs found at logs/dev-server.log"
  fi
elif [ -n "$SERVICE" ]; then
  # Show specific Docker service logs
  docker compose logs $FOLLOW --tail 50 "$SERVICE"
else
  # Show all Docker logs
  echo "📋 Docker Services Logs:"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  docker compose logs $FOLLOW --tail 50
fi

