# Placeholder Dockerfile for auth-service (Node.js)
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
# Install only production deps for service containers
RUN npm install --omit=dev
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm", "start"]
