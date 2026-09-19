FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js index.html styles.css script.js ./
COPY assets ./assets

EXPOSE 8080
USER node

CMD ["node", "server.js"]
