FROM node:22-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY server/ ./server/
RUN npx tsc

FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist/server ./dist/server
COPY public/ ./public/
COPY job-titles.csv ./
ENV PORT=3000
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
