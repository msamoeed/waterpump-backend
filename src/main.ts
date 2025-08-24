import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  // Configure logging with memory management
  const logger = new Logger('Bootstrap');
  
  // Set log levels to reduce memory usage
  process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
  
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log'], // Limit log levels in production
    bufferLogs: false, // Disable buffering to prevent memory buildup
  });
  
  // Enable CORS
  app.enableCors({
    origin: [
      'https://waterpump-frontend.vercel.app', // Allow your Vercel frontend
      'http://localhost:3000', // (optional) Allow local dev
    ],
    credentials: true, // if you use cookies/auth
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Global prefix for API routes
  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT || 3000;
  await app.listen(port);
  
  logger.log(`🚀 Water Pump Backend running on port ${port}`);
  logger.log(`📊 API available at http://localhost:${port}/api/v1`);
  logger.log(`🔌 WebSocket available at ws://localhost:${port}`);
}

bootstrap(); 