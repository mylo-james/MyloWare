# Multi-stage build for MyloWare platform
FROM node:20.11.0-alpine AS base

# Install dependencies needed for native modules
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY packages/*/package.json ./packages/*/

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Build stage
FROM base AS build

# Install all dependencies (including dev)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:20.11.0-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S myloware -u 1001

# Copy built application
COPY --from=build --chown=myloware:nodejs /app/dist ./dist
COPY --from=build --chown=myloware:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=myloware:nodejs /app/package*.json ./

# Switch to non-root user
USER myloware

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["node", "dist/packages/api-gateway/src/main.js"]