# syntax=docker/dockerfile:1
# Docker-сборка фронтенда/API ТОЛК (Next.js standalone) для запуска рядом с ASR.
# Vercel этот файл не использует. NEXT_PUBLIC_* вшиваются при СБОРКЕ (публичные значения,
# anon-ключ Supabase публичен по дизайну); серверные секреты передаются только в рантайме
# через env_file и в образ не попадают.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_JITSI_DOMAIN
ARG GIT_COMMIT=unknown
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_JITSI_DOMAIN=$NEXT_PUBLIC_JITSI_DOMAIN \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=4096
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ARG GIT_COMMIT=unknown
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    GIT_COMMIT=$GIT_COMMIT
RUN useradd --create-home --uid 10001 app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
# PDF-протокол читает шрифты по process.cwd()/src/assets/fonts — трассировка Next их не видит.
COPY --from=build --chown=app:app /app/src/assets/fonts ./src/assets/fonts
USER app
EXPOSE 3000
CMD ["node", "server.js"]
