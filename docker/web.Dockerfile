FROM node:24-bookworm-slim AS build
WORKDIR /build
RUN npm install --global pnpm@10.34.7
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build:web

FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /build/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
