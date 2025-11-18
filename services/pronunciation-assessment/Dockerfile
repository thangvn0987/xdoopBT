FROM node:18-bullseye-slim

WORKDIR /app

# System deps (certs). Speech SDK works on glibc-based images.
RUN apt-get update && apt-get install -y --no-install-recommends \
		ca-certificates \
	&& rm -rf /var/lib/apt/lists/*

# Install dependencies first (respect lockfile if present)
COPY package.json package-lock.json* ./
RUN npm ci --only=production || npm install --production

# Copy source
COPY . .

# Ensure uploads directory exists
RUN mkdir -p /app/uploads

ENV PORT=8085
EXPOSE 8085

CMD ["node", "index.js"]
