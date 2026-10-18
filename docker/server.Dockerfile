FROM node:24-bookworm-slim AS build
WORKDIR /build
RUN npm install --global pnpm@10.34.7
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/package.json
RUN pnpm install --frozen-lockfile --filter @browos/server...
COPY apps/server ./apps/server
RUN pnpm --filter @browos/server build
RUN pnpm --filter @browos/server deploy --prod --legacy /out/server

# The proxy has no Chromium binary, owner token, browser profiles or published port.
FROM node:24-bookworm-slim AS proxy
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/server/dist ./dist
USER node
EXPOSE 3128
CMD ["node", "dist/proxy-main.js"]

FROM node:24-bookworm-slim AS browser
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY --from=build --chown=node:node /out/server ./
COPY docker/install-chromium.mjs /usr/local/lib/browos-install-chromium.mjs
RUN apt-get update && apt-get install --yes --no-install-recommends ca-certificates curl unzip \
    && node node_modules/playwright/cli.js install-deps chromium \
    && node /usr/local/lib/browos-install-chromium.mjs \
    && chmod -R a+rX /ms-playwright \
    && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
