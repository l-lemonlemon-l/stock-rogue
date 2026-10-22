# Online multiplayer server (no Electron). Deploy anywhere that runs Docker.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY server ./server
COPY public ./public
COPY shared ./shared
ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/index.js"]
