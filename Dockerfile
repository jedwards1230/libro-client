FROM oven/bun:1 as base
WORKDIR /app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lockb /temp/dev/
RUN cd /temp/dev && bun install

FROM base AS release
COPY --from=install /temp/dev/node_modules ./node_modules
COPY . .

ENTRYPOINT [ "bun", "run", "service.ts" ]