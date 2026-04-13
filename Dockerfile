FROM node:22-slim AS build

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Vite needs these at build time (anon key is public, safe for client bundles)
ENV VITE_SUPABASE_URL=https://zeqavhwlappnlkemgiyn.supabase.co
ENV VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplcWF2aHdsYXBwbmxrZW1naXluIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5OTk1NDMsImV4cCI6MjA5MTU3NTU0M30.jnclVnHUUnQrqMOeNWjb1BYetzM5o1SByKuOnxE3yMA
ENV VITE_API_URL=/api


# Copy all package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install root and server dependencies
RUN npm install

# Copy source
COPY . .

# Fix platform-specific rollup binary (npm bug with optional deps from macOS lockfile)
RUN npm install @rollup/rollup-linux-x64-gnu

# Build client (uses ARGs above via Vite's import.meta.env)
RUN cd client && npx vite build

# Build server (ignore TS errors)
RUN cd server && npx tsc || true
RUN cp server/src/config/schema.sql server/dist/config/schema.sql 2>/dev/null || true

EXPOSE 3000

CMD ["node", "server/dist/server.js"]
