FROM node:22-bookworm-slim

WORKDIR /app

# Install Chromium dependencies for Remotion
RUN apt-get update && apt-get install -y \
  libnss3 \
  libdbus-1-3 \
  libatk1.0-0 \
  libgbm-dev \
  libasound2 \
  libxrandr2 \
  libxkbcommon-dev \
  libxfixes3 \
  libxcomposite1 \
  libxdamage1 \
  libatk-bridge2.0-0 \
  libpango-1.0-0 \
  libcairo2 \
  libcups2 \
  curl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm i

COPY tsconfig.json remotion.config.ts render.mjs ./
COPY src ./src
COPY api ./api
COPY templates ./templates

# Install Chrome Headless Shell for Remotion rendering
RUN npx remotion browser ensure

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

# Run with tsx for TypeScript support without separate build step
CMD ["npx", "tsx", "api/server.ts"]
