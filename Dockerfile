FROM node:18-alpine

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for development)
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build arguments
ARG NODE_ENV=production

# Build the application only for production
RUN if [ "$NODE_ENV" = "production" ]; then npm run build; fi

# Expose port
EXPOSE 3000

# Set Node.js memory options
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Start the application based on environment
CMD if [ "$NODE_ENV" = "production" ]; then node dist/main.js; else npm run start:dev; fi 