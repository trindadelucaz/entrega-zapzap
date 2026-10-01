FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV NODE_ENV=production DB_PATH=/data/deliveries.sqlite
CMD ["node", "src/server.js"]
