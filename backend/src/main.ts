import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  app.enableCors({ origin: corsOrigin });

  const host = process.env.API_HOST || '0.0.0.0';
  const port = parseInt(process.env.API_PORT || '3001', 10);

  await app.listen(port, host);
  console.log(`🚀 [NestJS Backend] Running on http://${host}:${port}`);
}

bootstrap();
