# 🔥 FIX: Use official Playwright image (includes browsers preinstalled)
FROM mcr.microsoft.com/playwright:v1.59.1-jammy

# Set working directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm install --production

# Copy source code
COPY . .

# IMPORTANT: DO NOT run "npx playwright install"
# Browsers already exist in this base image

# Start server
CMD ["node", "server.js"]
