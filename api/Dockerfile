FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY api/package.json api/package-lock.json ./
RUN npm ci
COPY api/tsconfig.json ./
COPY api/src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY api/package.json api/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
USER node
CMD ["node", "dist/main.js"]
