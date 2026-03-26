FROM node:22-alpine

WORKDIR /workspace

RUN npm install -g pnpm@10.6.2

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY prisma ./prisma
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/shared/package.json ./packages/shared/package.json
COPY packages/trading-core/package.json ./packages/trading-core/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm exec prisma generate

EXPOSE 4000

CMD ["sh", "-lc", "pnpm exec prisma db push --skip-generate && pnpm --filter @stratium/api dev"]
