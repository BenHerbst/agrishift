FROM node:24-slim
WORKDIR /app
COPY package.json bun.lock* ./
RUN npm install --legacy-peer-deps
COPY . .
RUN npx vite build
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "server.ts"]
