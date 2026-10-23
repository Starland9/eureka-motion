# syntax=docker/dockerfile:1
# Build from the repository root: docker build -f workers/render/Dockerfile .
FROM node:22-bookworm-slim

# Libraries of Chrome Headless Shell, as listed by https://www.remotion.dev/docs/docker
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libgbm-dev \
    libnss3 \
    libpango-1.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxkbcommon-dev \
    libxrandr2 \
  && rm -rf /var/lib/apt/lists/*

ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

# The worker imports the job queue and the schema from the web application, which resolve
# their own dependencies from apps/web.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/scene/package.json packages/scene/
COPY workers/render/package.json workers/render/
RUN --mount=type=cache,target=/pnpm/store \
  pnpm install --frozen-lockfile --fetch-timeout=300000 --fetch-retries=5 \
    --filter "render-worker..." --filter web

COPY packages/scene packages/scene
COPY apps/web/src/server apps/web/src/server
COPY content/reference content/reference
COPY workers/render/tsconfig.json workers/render/
COPY workers/render/src workers/render/src

WORKDIR /repo/workers/render
RUN node -e "import('@remotion/renderer').then(({ ensureBrowser }) => ensureBrowser())"

ENV MEDIA_DIR=/data/media SANDBOX_DIR=/data/sandbox REFERENCE_DIR=/repo/content/reference
RUN mkdir -p /data/media /data/sandbox && chown node:node /data/media /data/sandbox
USER node

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=4 \
  CMD node -e "const fs = require('node:fs'); const beat = JSON.parse(fs.readFileSync(process.env.MEDIA_DIR + '/.health/worker.json', 'utf8')); process.exit(Date.now() - Date.parse(beat.render_at) < 60000 ? 0 : 1)"

CMD ["node_modules/.bin/tsx", "src/index.ts"]
