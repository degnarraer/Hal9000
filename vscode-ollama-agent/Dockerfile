FROM node:18.17.1-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV TTS_PIPER_BIN=/opt/piper/piper
ENV FASTER_WHISPER_PYTHON=/opt/faster-whisper/bin/python
ENV FASTER_WHISPER_CACHE_DIR=/data/faster-whisper

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl tar python3 python3-venv make g++ pkg-config libffi-dev libgomp1 \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt \
  && python3 -m venv /opt/faster-whisper \
  && /opt/faster-whisper/bin/pip install --no-cache-dir faster-whisper \
  && curl -fsSL https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz \
    | tar -xz -C /opt \
  && chmod +x /opt/piper/piper

COPY package*.json ./
RUN npm ci --omit=dev \
  && node -e "require('vosk'); console.log('vosk module loaded')" \
  && /opt/faster-whisper/bin/python -c "import faster_whisper; print('faster-whisper module loaded')"

COPY . .

EXPOSE 3000

CMD ["node", "server/index.js"]
