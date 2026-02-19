FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY server/ ./server/
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# dist/server/index.js does join(__dirname, '..') which resolves to /app/dist/
# So public/ and job-titles.csv need to be relative to that
COPY --from=build /app/dist/server ./dist/server
COPY public/ ./dist/public/
COPY job-titles.csv ./dist/
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
