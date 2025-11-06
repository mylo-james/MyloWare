# syntax=docker/dockerfile:1

# Install deps (shared by build + dev stages)
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# Build stage compiles the TypeScript once for production
FROM deps AS build
COPY . .
RUN npm run build

# Dev stage powers hot reload (npm run dev / tsx watch)
FROM node:20-slim AS dev
WORKDIR /app
ENV NODE_ENV=development
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
# Install ALL dependencies including devDependencies for dev mode
COPY package*.json ./
RUN npm ci
COPY . .
EXPOSE 3456
CMD ["npm", "run", "dev"]

# Production stage - MCP server
FROM node:20-slim AS mcp-server
WORKDIR /app

# Install curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

# Copy package files and install production deps only
COPY package*.json ./
RUN npm ci --only=production

# Copy built code from build stage
COPY --from=build /app/dist ./dist

# Expose port (configurable via env)
EXPOSE 3456

# Health check (using env var for port)
HEALTHCHECK --interval=10s --timeout=3s --start-period=30s \
  CMD curl -f http://localhost:${SERVER_PORT:-3456}/health || exit 1

# Start server
CMD ["node", "dist/server.js"]
