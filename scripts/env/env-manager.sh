#!/bin/bash
# Environment Manager Script
# Manages test, dev, and prod environments

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

usage() {
  echo "Usage: $0 {test|dev|prod} {start|stop|restart|reset|logs|status}"
  echo ""
  echo "Environments:"
  echo "  test  - Ephemeral test environment (ports: 3457, 5433, 5679)"
  echo "  dev   - Development environment with hot reload (ports: 3456, 6543, 5678)"
  echo "  prod  - Production environment (ports: 3456, 5432, 5678)"
  echo ""
  echo "Commands:"
  echo "  start   - Start the environment"
  echo "  stop    - Stop the environment"
  echo "  restart - Restart the environment"
  echo "  reset   - Stop, remove volumes, and start fresh"
  echo "  logs    - Follow logs"
  echo "  status  - Show status of services"
  exit 1
}

if [ $# -lt 2 ]; then
  usage
fi

ENV=$1
COMMAND=$2

# Validate environment
if [[ ! "$ENV" =~ ^(test|dev|prod)$ ]]; then
  echo -e "${RED}Error: Invalid environment '$ENV'${NC}"
  usage
fi

# Set env file
ENV_FILE="$PROJECT_ROOT/.env.$ENV"
if [ ! -f "$ENV_FILE" ]; then
  echo -e "${RED}Error: Environment file not found: $ENV_FILE${NC}"
  exit 1
fi

echo -e "${BLUE}🔧 Using environment: $ENV${NC}"
echo -e "${BLUE}📄 Config file: $ENV_FILE${NC}"

# Export env vars
export $(grep -v '^#' "$ENV_FILE" | xargs)

case $COMMAND in
  start)
    echo -e "${GREEN}🚀 Starting $ENV environment...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ "$ENV" = "test" ]; then
      docker compose --profile test up -d
    elif [ "$ENV" = "dev" ]; then
      docker compose up -d postgres n8n
      echo -e "${YELLOW}💡 Starting MCP server locally with hot reload...${NC}"
      npm run dev
    elif [ "$ENV" = "prod" ]; then
      docker compose --profile prod up -d
    fi
    
    echo -e "${GREEN}✅ $ENV environment started${NC}"
    echo ""
    echo "Access points:"
    if [ "$ENV" = "test" ]; then
      echo "  MCP Server: http://localhost:3457"
      echo "  n8n: http://localhost:5679"
      echo "  Postgres: localhost:5433"
    elif [ "$ENV" = "dev" ]; then
      echo "  MCP Server: http://localhost:3456"
      echo "  n8n: http://localhost:5678"
      echo "  Postgres: localhost:6543"
    elif [ "$ENV" = "prod" ]; then
      echo "  MCP Server: http://localhost:3456"
      echo "  n8n: http://localhost:5678"
      echo "  Postgres: localhost:5432"
    fi
    ;;
    
  stop)
    echo -e "${YELLOW}🛑 Stopping $ENV environment...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ "$ENV" = "test" ]; then
      docker compose --profile test down
    elif [ "$ENV" = "dev" ]; then
      pkill -f "tsx.*server.ts" || true
      docker compose down
    elif [ "$ENV" = "prod" ]; then
      docker compose --profile prod down
    fi
    
    echo -e "${GREEN}✅ $ENV environment stopped${NC}"
    ;;
    
  restart)
    echo -e "${BLUE}♻️  Restarting $ENV environment...${NC}"
    $0 $ENV stop
    sleep 2
    $0 $ENV start
    ;;
    
  reset)
    echo -e "${RED}🗑️  Resetting $ENV environment (this will DELETE all data)...${NC}"
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
      echo "Cancelled."
      exit 0
    fi
    
    cd "$PROJECT_ROOT"
    
    if [ "$ENV" = "test" ]; then
      docker compose --profile test down -v
      echo -e "${GREEN}✅ Test environment reset (volumes deleted)${NC}"
    elif [ "$ENV" = "dev" ]; then
      pkill -f "tsx.*server.ts" || true
      docker compose down -v
      echo -e "${GREEN}✅ Dev environment reset (volumes deleted)${NC}"
      echo -e "${YELLOW}💡 Run '$0 dev start' to recreate${NC}"
    elif [ "$ENV" = "prod" ]; then
      docker compose --profile prod down -v
      echo -e "${GREEN}✅ Prod environment reset (volumes deleted)${NC}"
      echo -e "${RED}⚠️  WARNING: Production data has been deleted!${NC}"
    fi
    ;;
    
  logs)
    echo -e "${BLUE}📋 Following logs for $ENV environment...${NC}"
    cd "$PROJECT_ROOT"
    
    if [ "$ENV" = "test" ]; then
      docker compose --profile test logs -f
    elif [ "$ENV" = "dev" ]; then
      docker compose logs -f
    elif [ "$ENV" = "prod" ]; then
      docker compose --profile prod logs -f
    fi
    ;;
    
  status)
    echo -e "${BLUE}📊 Status of $ENV environment:${NC}"
    cd "$PROJECT_ROOT"
    
    if [ "$ENV" = "test" ]; then
      docker compose --profile test ps
    elif [ "$ENV" = "dev" ]; then
      docker compose ps
      echo ""
      echo "MCP Server (local):"
      if pgrep -f "tsx.*server.ts" > /dev/null; then
        echo -e "${GREEN}  ✅ Running (PID: $(pgrep -f 'tsx.*server.ts'))${NC}"
      else
        echo -e "${RED}  ❌ Not running${NC}"
      fi
    elif [ "$ENV" = "prod" ]; then
      docker compose --profile prod ps
    fi
    ;;
    
  *)
    echo -e "${RED}Error: Invalid command '$COMMAND'${NC}"
    usage
    ;;
esac


