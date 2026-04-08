FROM node:22-alpine

WORKDIR /workspace

RUN npm install -g pnpm@10.6.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/api/package.json ./apps/api/package.json
COPY apps/batch/package.json ./apps/batch/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/trading-core/package.json ./packages/trading-core/package.json

RUN pnpm install --frozen-lockfile

COPY apps/batch ./apps/batch
COPY packages/shared ./packages/shared

RUN pnpm --filter @stratium/shared build
RUN pnpm --filter @stratium/batch build

WORKDIR /workspace/apps/batch

CMD ["sh", "-lc", "echo 'Batch is docker-job only. Pass an explicit command to docker compose run.' && exit 1"]
