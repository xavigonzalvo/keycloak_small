# syntax=docker/dockerfile:1

# --- Stage 1: Build the React frontend ---
FROM node:20-alpine AS frontend-build
WORKDIR /build
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Production Node.js server ---
FROM node:20-alpine
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=frontend-build /build/dist ./frontend/dist

USER app
EXPOSE 3000
CMD ["node", "server.js"]
