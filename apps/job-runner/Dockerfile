FROM node:22-alpine

WORKDIR /workspace

RUN apk add --no-cache docker-cli docker-cli-compose
RUN npm install -g pnpm@10.6.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/api/package.json ./apps/api/package.json
COPY apps/batch/package.json ./apps/batch/package.json
COPY apps/job-runner/package.json ./apps/job-runner/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/trading-core/package.json ./packages/trading-core/package.json

RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 4300

CMD ["sh", "-lc", "pnpm --filter @stratium/job-runner dev"]
