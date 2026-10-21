FROM mcr.microsoft.com/playwright:v1.62.1-noble

# Real init so orphaned Chrome processes get reaped
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./
COPY prisma.config.ts ./
COPY prisma ./prisma/

# Install dependencies
RUN npm ci

# Copy TypeScript configuration and application source
COPY tsconfig.json ./
COPY src ./src/

# Generate Prisma Client and compile TypeScript
RUN npm run build

# Default port for Railway (injected at runtime via $PORT)
ENV PORT=8080
EXPOSE 8080

# Database migrations run as a one-time deployment pre-deploy command (`npm run migrate`).
# The application container starts only the server to avoid per-replica migration races.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server.js"]
