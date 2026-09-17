FROM mcr.microsoft.com/playwright:v1.62.1-noble

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

# Execute database migrations on container start then start the server
CMD ["npm", "run", "start"]
