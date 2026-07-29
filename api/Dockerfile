# API Node 20 (Alpine). sharp requiere libvips + fuentes para la marca de agua.
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

FROM node:20-alpine
WORKDIR /app
# Fuentes para el watermark de previews (sharp/SVG); sin esto salen cajitas.
RUN apk add --no-cache fontconfig ttf-dejavu && fc-cache -f
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
CMD ["node", "src/server.js"]
