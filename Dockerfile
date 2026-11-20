FROM oven/bun:1-alpine 
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY . .
ENV NODE_ENV=production
ENV PORT=8500
EXPOSE 8500

CMD ["bun", "run", "src/server.ts"]