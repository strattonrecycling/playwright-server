FROM mcr.microsoft.com/playwright:v1.59.1-jammy

WORKDIR /app

COPY package*.json ./
RUN npm install

# 🔥 ENSURE BROWSERS EXIST
RUN npx playwright install --with-deps

COPY . .

CMD ["node", "server.js"]
