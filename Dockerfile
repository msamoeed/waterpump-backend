# Multi-stage build for DuckDB compatibility
FROM node:18-slim AS builder

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage
FROM node:18-slim AS production

# Install runtime dependencies for DuckDB
RUN apt-get update && apt-get install -y \
    libc6 \
    libstdc++6 \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create data directory for DuckDB
RUN mkdir -p /app/data

# Expose port
EXPOSE 3000

# Set Node.js memory options
ENV NODE_OPTIONS="--max-old-space-size=4096"

# Set DuckDB data path
ENV DUCKDB_PATH="/app/data/waterpump_data.duckdb"

# Start the application
CMD ["node", "dist/main.js"] 