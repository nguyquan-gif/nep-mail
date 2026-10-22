FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build:selfhost && pnpm prune --prod
FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data
RUN mkdir /data && chown node:node /data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/selfhost ./selfhost
COPY --from=build /app/src/core ./src/core
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/selfhost-dist ./selfhost-dist
USER node
EXPOSE 3000
CMD ["node","selfhost/server.ts"]
