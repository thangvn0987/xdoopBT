# Placeholder Dockerfile for ai-service (Node.js)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# System deps for audio processing
RUN apk add --no-cache ffmpeg \
	&& npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
