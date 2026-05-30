# Stage 1: build the Next.js workspace as a standalone server.
FROM node:22-bookworm-slim AS workspace-build

WORKDIR /app/workspace
ENV NEXT_TELEMETRY_DISABLED=1

COPY workspace/package*.json ./
RUN npm ci

COPY workspace/ ./
RUN npm run build

# Stage 2: run Next.js with the Exergy Analyst Python package available.
FROM python:3.12-slim AS runtime

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    ENGINE_ROOT=/app/engine \
    EXERGY_ANALYST_ROOT=/app/engine \
    PYTHON_PATH=/usr/local/bin/python \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    g++ \
    gcc \
    git \
    make \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/engine

COPY pyproject.toml README.md ./
COPY src ./src
COPY scripts ./scripts
COPY examples ./examples

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -e ".[parsers]"

RUN mkdir -p \
    runtime/db \
    runtime/sessions \
    runtime/projects \
    runtime/workspace_jobs \
    runtime/workspace_briefs \
    runtime/evidence \
    runtime/ingestion \
    runtime/ptl_briefs

WORKDIR /app/nextjs

COPY --from=workspace-build /app/workspace/.next/standalone ./
COPY --from=workspace-build /app/workspace/.next/static ./.next/static
COPY --from=workspace-build /app/workspace/public ./public

COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

EXPOSE 10000

CMD ["/app/start.sh"]
