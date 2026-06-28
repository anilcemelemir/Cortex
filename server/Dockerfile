# Backend (REST + WebSocket + SQLite). Native derleme yok — node:sqlite dahili.
FROM node:24-alpine

WORKDIR /app

# Sadece bağımlılıklar için katman önbelleği
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV PORT=8080
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8080

CMD ["node", "index.js"]
