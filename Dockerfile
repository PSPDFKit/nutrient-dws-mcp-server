# Build stage
FROM node:20-alpine AS builder

RUN npm install -g pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Runtime stage
FROM node:20-alpine AS runtime

RUN npm install -g pnpm && addgroup -S appgroup && adduser -S appuser -G appgroup
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/dist ./dist

RUN chown -R appuser:appgroup /app
USER appuser

# MCP runs over stdio
ENTRYPOINT ["node", "dist/index.js"]
