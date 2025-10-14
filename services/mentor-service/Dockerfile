# Placeholder Dockerfile for mentor-service (Node.js)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production || npm ci
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
