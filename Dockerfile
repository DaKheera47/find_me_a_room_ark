# Base image
FROM node:18

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
