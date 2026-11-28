FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY dist ./dist
# The Fly release command (dist/db/migrate.js) resolves migrations/ from cwd.
COPY migrations ./migrations
EXPOSE 8080
CMD ["node", "dist/index.js"]
