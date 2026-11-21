FROM oven/bun:1-alpine AS base
WORKDIR /app

COPY package.json bun.lock ./

FROM base AS tools
RUN bun install --frozen-lockfile
COPY . .
CMD ["bun", "run", "db:seed"]

FROM base AS production
RUN bun install --frozen-lockfile --production
COPY . .
ENV NODE_ENV=production
ENV PORT=8500
EXPOSE 8500

CMD ["bun", "run", "src/server.ts"]
