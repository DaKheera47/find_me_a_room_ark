FROM node:20-slim

# We don't need the standalone Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD true

# Install Google Chrome Stable, fonts, and build dependencies for native modules
# Note: this installs the necessary libs to make the browser work with Puppeteer.
RUN apt-get update && apt-get install gnupg wget python3 make g++ -y && \
  wget --quiet --output-document=- https://dl-ssl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /etc/apt/trusted.gpg.d/google-archive.gpg && \
  sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' && \
  apt-get update && \
  apt-get install google-chrome-stable -y --no-install-recommends && \
  rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy package files and install deps
COPY package*.json ./
RUN npm install

# Copy everything else
COPY . .

# Build the TypeScript code
RUN npm run build

# Expose the port
EXPOSE 8072

# Start the app
CMD ["node", "dist/index.js"]
