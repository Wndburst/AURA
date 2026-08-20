# ---------- build ----------
FROM node:22-alpine AS builder
WORKDIR /app

# Las dependencias primero: así el cache sobrevive a los cambios de código.
COPY package.json package-lock.json ./
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci --ignore-scripts=false

COPY . .
RUN npm run build

# Fuera todo lo que sólo servía para compilar.
RUN npm prune --omit=dev

# ---------- runtime ----------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/app/data

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/server/package.json ./server/package.json
COPY --from=builder /app/server/dist ./server/dist
COPY --from=builder /app/client/dist ./client/dist

# El snapshot del leaderboard vive acá. Monta un volumen si quieres que
# sobreviva a un redeploy.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# --init da un PID 1 de verdad: SIGTERM llega y el snapshot alcanza a guardarse.
ENTRYPOINT ["node", "--enable-source-maps", "server/dist/index.js"]
