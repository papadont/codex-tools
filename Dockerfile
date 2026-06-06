FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY scripts ./scripts

USER node
CMD ["node", "scripts/codex_memo_remote_mcp_server.mjs"]
