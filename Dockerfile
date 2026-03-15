FROM node:20-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY package*.json ./
RUN npm ci --omit=dev

# Pre-download model during build so runtime never hits the network
COPY download-model.js ./
RUN node download-model.js

# Copy the rest of the app
COPY . .

EXPOSE 8080
CMD ["node", "index.js"]
