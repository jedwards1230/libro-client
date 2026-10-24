FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
RUN mkdir -p /temp/dev
COPY package.json bun.lock /temp/dev/
RUN cd /temp/dev && bun install

FROM base AS release
COPY --from=install /temp/dev/node_modules ./node_modules
COPY . .

# Reported as the `version` label of libro_info; the release workflow passes it.
ARG LIBRO_VERSION=unknown
ENV LIBRO_VERSION=$LIBRO_VERSION

# Prometheus metrics (METRICS_PORT)
EXPOSE 9464

ENTRYPOINT [ "bun", "run", "service.ts" ]
