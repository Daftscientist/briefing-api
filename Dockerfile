FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Public-facing server (only health + token)
FROM node:22-alpine AS public
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 briefing
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER briefing
EXPOSE 3001
CMD ["node", "dist/public.js"]

# Internal server (all routes with auth checks)
FROM node:22-alpine AS internal
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 briefing
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
USER briefing
EXPOSE 3002
CMD ["node", "dist/internal.js"]
