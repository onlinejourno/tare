FROM node:20-slim

RUN apt-get update && apt-get install -y \
    ca-certificates wget gnupg \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libx11-6 \
    libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 libx11-xcb1 \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Install from the lockfile. Copying only package.json and running `npm install`
# re-resolves every semver range at build time, so the dependency set — and for
# Playwright the browser binary that `playwright install` then fetches — can
# change between two builds of the same commit. `npm ci` installs exactly what
# the lockfile names, which is also what the test suite runs against.
COPY package.json package-lock.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
ENV PLAYWRIGHT_BROWSERS_PATH=/app/pw-browsers
RUN npx playwright install chromium
COPY . .
ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server/index.js"]
