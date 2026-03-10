# BitLink21 Web UI — React + Vite + Tailwind CSS
# Multi-stage build: Node builder → nginx runtime (with API + WS reverse proxy)

# Build stage
FROM node:18-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node index.html vite.config.js postcss.config.js tailwind.config.js ./
COPY --chown=node:node VERSION ./VERSION

# Build with Vite (production mode)
RUN NODE_ENV=production npm run build

# Production stage — nginx with reverse proxy for API + WebSocket
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx config (proxies /api/ to core, /ws to radio)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy entrypoint script (injects API token into nginx config for Umbrel)
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -qO /dev/null http://127.0.0.1:3000/ || exit 1

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
