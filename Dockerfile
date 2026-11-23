
FROM node:24-bookworm-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

ENV NODE_ENV=production
ENV PORT=3000
COPY backend.js ./
COPY public ./public
COPY templates ./templates

USER node
EXPOSE 3000
CMD ["node", "backend.js"]
