FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV TTS_PIPER_BIN=/opt/piper/piper

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt \
  && curl -fsSL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    | tar -xz -C /opt \
  && chmod +x /opt/piper/piper

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server/index.js"]
