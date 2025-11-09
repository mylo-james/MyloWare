#!/bin/bash
# n8n CLI Wrapper
# Manages n8n workflows and credentials using the n8n CLI inside Docker container

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

usage() {
  echo "Usage: $0 {dev|test|prod} {command}"
  echo ""
  echo "Commands:"
  echo "  list-workflows           - List all workflows"
  echo "  list-credentials         - List all credentials"
  echo "  import-workflows         - Import all workflows from ./workflows"
  echo "  import-credentials       - Import credentials from file"
  echo "  export-workflows         - Export all workflows"
  echo "  export-credentials       - Export all credentials"
  echo "  activate-all             - Activate all workflows"
  echo "  setup                    - Complete setup (import + create creds + activate)"
  echo ""
  echo "Examples:"
  echo "  $0 dev list-workflows"
  echo "  $0 dev setup"
  echo "  $0 test import-workflows"
  exit 1
}

if [ $# -lt 2 ]; then
  usage
fi

ENV=$1
COMMAND=$2

# Validate environment
if [[ ! "$ENV" =~ ^(dev|test|prod)$ ]]; then
  echo -e "${RED}Error: Invalid environment '$ENV'${NC}"
  usage
fi

# Determine container name
if [ "$ENV" = "test" ]; then
  CONTAINER="n8n-test"
elif [ "$ENV" = "dev" ]; then
  CONTAINER="n8n"
else
  CONTAINER="n8n"  # prod
fi

# Check if container is running
if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER}$"; then
  echo -e "${RED}Error: Container '$CONTAINER' is not running${NC}"
  echo -e "${YELLOW}Start it with: npm run env:${ENV} start${NC}"
  exit 1
fi

echo -e "${BLUE}🔧 Managing n8n in container: $CONTAINER${NC}\n"

case $COMMAND in
  list-workflows)
    echo -e "${CYAN}📋 Listing workflows...${NC}\n"
    docker exec $CONTAINER n8n list:workflow
    ;;
    
  list-credentials)
    echo -e "${CYAN}🔑 Listing credentials...${NC}\n"
    docker exec $CONTAINER n8n list:credential
    ;;
    
  import-workflows)
    echo -e "${CYAN}📥 Importing workflows...${NC}\n"
    cd "$PROJECT_ROOT"
    
    # Use the npm script which handles URL rewriting
    if [ "$ENV" = "dev" ]; then
      npm run import:workflows:dev
    elif [ "$ENV" = "test" ]; then
      npm run import:workflows:test
    else
      npm run import:workflows:prod
    fi
    ;;
    
  import-credentials)
    CREDS_FILE="${3:-$PROJECT_ROOT/data/credentials/n8n-credentials.json}"
    
    if [ ! -f "$CREDS_FILE" ]; then
      echo -e "${RED}Error: Credentials file not found: $CREDS_FILE${NC}"
      exit 1
    fi
    
    echo -e "${CYAN}📥 Importing credentials from: $CREDS_FILE${NC}\n"
    docker exec -i $CONTAINER n8n import:credentials --input=/dev/stdin < "$CREDS_FILE"
    ;;
    
  export-workflows)
    OUTPUT_DIR="${3:-$PROJECT_ROOT/exports/workflows-$(date +%Y%m%d-%H%M%S)}"
    mkdir -p "$OUTPUT_DIR"
    
    echo -e "${CYAN}📤 Exporting workflows to: $OUTPUT_DIR${NC}\n"
    docker exec $CONTAINER n8n export:workflow --all --output=/tmp/n8n-export
    docker cp $CONTAINER:/tmp/n8n-export/. "$OUTPUT_DIR/"
    
    echo -e "${GREEN}✅ Exported to: $OUTPUT_DIR${NC}"
    ;;
    
  export-credentials)
    OUTPUT_DIR="${3:-$PROJECT_ROOT/exports/credentials-$(date +%Y%m%d-%H%M%S)}"
    mkdir -p "$OUTPUT_DIR"
    
    echo -e "${CYAN}📤 Exporting credentials to: $OUTPUT_DIR${NC}\n"
    docker exec $CONTAINER n8n export:credentials --all --output=/tmp/n8n-cred-export
    docker cp $CONTAINER:/tmp/n8n-cred-export/. "$OUTPUT_DIR/"
    
    echo -e "${GREEN}✅ Exported to: $OUTPUT_DIR${NC}"
    echo -e "${YELLOW}⚠️  Credentials are encrypted and contain sensitive data${NC}"
    ;;
    
  activate-all)
    echo -e "${CYAN}🔄 Activating all workflows...${NC}\n"
    
    # Load API key from env file (read specific vars, don't source)
    API_KEY=$(grep "^N8N_API_KEY=" "$PROJECT_ROOT/.env.$ENV" | cut -d '=' -f2-)
    N8N_URL=$(grep "^N8N_BASE_URL=" "$PROJECT_ROOT/.env.$ENV" | cut -d '=' -f2-)
    
    # Get list of workflow IDs
    WORKFLOW_IDS=$(docker exec $CONTAINER n8n list:workflow | tail -n +2 | cut -d '|' -f1 | tr -d ' ')
    
    for WF_ID in $WORKFLOW_IDS; do
      if [ -n "$WF_ID" ]; then
        echo -e "   Activating: $WF_ID"
        RESULT=$(curl -s -X POST \
          -H "X-N8N-API-KEY: ${API_KEY}" \
          "${N8N_URL}/api/v1/workflows/${WF_ID}/activate")
        
        if echo "$RESULT" | grep -q '"active":true'; then
          echo -e "      ${GREEN}✓${NC} Activated"
        elif echo "$RESULT" | grep -q 'already active'; then
          echo -e "      ${YELLOW}→${NC} Already active"
        else
          echo -e "      ${RED}✗${NC} Failed: $(echo $RESULT | jq -r '.message // .')"
        fi
      fi
    done
    
    echo -e "\n${GREEN}✅ Activation complete${NC}"
    ;;
    
  setup)
    echo -e "${BLUE}🚀 Complete n8n setup for $ENV environment${NC}\n"
    
    # Step 1: Create MCP credential
    echo -e "${CYAN}Step 1: Creating MCP credential...${NC}"
    $0 $ENV create-mcp-credential
    
    # Step 2: Import workflows
    echo -e "\n${CYAN}Step 2: Importing workflows...${NC}"
    $0 $ENV import-workflows
    
    # Step 3: Activate workflows
    echo -e "\n${CYAN}Step 3: Activating workflows...${NC}"
    $0 $ENV activate-all
    
    echo -e "\n${GREEN}✅ Setup complete!${NC}"
    echo -e "${CYAN}Test with: npm run workflow:test:$ENV \"your message\"${NC}"
    ;;
    
  create-mcp-credential)
    echo -e "${CYAN}🔑 Creating MCP credential...${NC}\n"
    
    # Load keys from env file
    MCP_KEY=$(grep "^MCP_AUTH_KEY=" "$PROJECT_ROOT/.env.$ENV" | cut -d '=' -f2-)
    API_KEY=$(grep "^N8N_API_KEY=" "$PROJECT_ROOT/.env.$ENV" | cut -d '=' -f2-)
    N8N_URL=$(grep "^N8N_BASE_URL=" "$PROJECT_ROOT/.env.$ENV" | cut -d '=' -f2-)
    
    # Create credential via API
    RESULT=$(docker exec $CONTAINER curl -s -X POST \
      -H "Content-Type: application/json" \
      -H "X-N8N-API-KEY: ${API_KEY}" \
      "http://localhost:5678/api/v1/credentials" \
      -d "{
        \"name\": \"Mylo MCP\",
        \"type\": \"httpHeaderAuth\",
        \"data\": {
          \"name\": \"X-API-Key\",
          \"value\": \"${MCP_KEY}\"
        }
      }")
    
    if echo "$RESULT" | grep -q '"id"'; then
      CRED_ID=$(echo "$RESULT" | jq -r '.id')
      echo -e "${GREEN}✅ MCP credential created: $CRED_ID${NC}"
    else
      echo -e "${YELLOW}⚠️  Response: $RESULT${NC}"
      echo -e "${YELLOW}Credential may already exist${NC}"
    fi
    ;;
    
  *)
    echo -e "${RED}Error: Unknown command '$COMMAND'${NC}"
    usage
    ;;
esac


