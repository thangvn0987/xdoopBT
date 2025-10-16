## Frontend production image: build with Vite, then serve static files

# 1) Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# 2) Runtime stage (serve static dist via a tiny Express server)
FROM node:20-alpine AS runner
WORKDIR /app
# Install only what's needed to serve static files
RUN npm install express serve-static
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=builder /app/dist ./dist
COPY server.js ./server.js
EXPOSE 3000
CMD ["node", "server.js"]
