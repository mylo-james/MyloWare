# syntax=docker/dockerfile:1.8

ARG NODE_VERSION=20-slim

FROM node:${NODE_VERSION} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev
COPY . .
CMD ["npm", "run", "dev"]

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:${NODE_VERSION} AS prod
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY cloudflared ./cloudflared
RUN npm prune --omit=dev
EXPOSE 3456
CMD ["node", "dist/server.js"]
