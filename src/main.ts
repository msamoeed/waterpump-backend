import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
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
  
  console.log(`🚀 Water Pump Backend running on port ${port}`);
  console.log(`📊 API available at http://localhost:${port}/api/v1`);
  console.log(`🔌 WebSocket available at ws://localhost:${port}`);
}

bootstrap(); 