FROM node:20-bookworm-slim

# Install system dependencies: ffmpeg, aria2, python3, curl, ca-certificates
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    aria2 \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install latest yt-dlp binary
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install npm dependencies
RUN npm install --production

# Copy application files
COPY . .

# Ensure directory permissions
RUN chmod -R 755 /app

ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
