FROM node:22-bookworm-slim AS pnpm-base

ENV PNPM_HOME=/pnpm
ENV PATH=${PNPM_HOME}:${PATH}

RUN npm install --global pnpm@11.15.1
WORKDIR /app

FROM pnpm-base AS build-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM build-dependencies AS build

COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN pnpm build

FROM pnpm-base AS production-dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/modules/mail/template/mjml ./src/modules/mail/template/mjml
COPY package.json ./

USER node
EXPOSE 3001

CMD ["node", "dist/main.js"]
