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

EXPOSE 3001

# Readiness turns unhealthy if model loading fails or inference wedges. The
# process watchdog exits a genuinely stuck worker so Coolify's restart policy
# can replace it instead of leaving a dead-but-running container forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "supervisor.js"]
