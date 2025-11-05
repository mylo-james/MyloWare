# syntax=docker/dockerfile:1

# Base stage - shared dependencies
FROM node:20-slim AS base
WORKDIR /app

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev for building)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Production stage - MCP server
FROM node:20-slim AS mcp-server
WORKDIR /app

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --only=production

# Copy built code from base stage
COPY --from=base /app/dist ./dist

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s \
  CMD curl -f http://localhost:3000/health || exit 1

# Start server
CMD ["node", "dist/server.js"]

