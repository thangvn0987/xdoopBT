# Placeholder Dockerfile for mentor-service (Node.js)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN true
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
