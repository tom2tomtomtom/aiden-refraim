FROM node:22-slim AS build

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy all package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install root and server dependencies
RUN npm install

# Copy source
COPY . .

# Install client dependencies fresh inside the container (fixes platform-specific rollup binary)
RUN cd client && rm -rf node_modules package-lock.json && npm install

# Build client
RUN cd client && npx vite build

# Build server (ignore TS errors)
RUN cd server && npx tsc || true
RUN cp server/src/config/schema.sql server/dist/config/schema.sql 2>/dev/null || true

EXPOSE 3000

CMD ["node", "server/dist/server.js"]
