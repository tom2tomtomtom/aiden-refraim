FROM node:22-slim

# Install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY server/package*.json ./server/
COPY client/package*.json ./client/

# Install all dependencies
RUN npm install

# Copy source
COPY . .

# Build client
RUN cd client && npx vite build

# Build server (ignore TS errors)
RUN cd server && npx tsc || true
RUN cp server/src/config/schema.sql server/dist/config/schema.sql 2>/dev/null || true

EXPOSE 3000

CMD ["node", "server/dist/server.js"]
