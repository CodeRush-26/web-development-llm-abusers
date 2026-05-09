# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps ./apps

RUN npm ci

RUN npm run build -w @strait-command/shared && \
    npm run build -w @strait-command/server

ARG NEXT_PUBLIC_WS_URL=http://localhost:4000
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build -w @strait-command/web

# Intermediate image for docker-compose `target: web` (not the default final stage).
FROM node:22-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/web ./apps/web
COPY --from=build /app/node_modules ./node_modules

EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@strait-command/web"]

# Default final stage — used by `docker build .` (e.g. Hugging Face Docker Spaces).
# docker-compose overrides PORT to 4000 for local API via environment.
FROM node:22-bookworm-slim AS api
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=7860

COPY scripts/healthcheck.cjs /healthcheck.cjs

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/server ./apps/server
COPY --from=build /app/node_modules ./node_modules

EXPOSE 7860

HEALTHCHECK --interval=5s --timeout=4s --start-period=15s --retries=6 CMD ["node", "/healthcheck.cjs"]

CMD ["node", "apps/server/dist/index.js"]
