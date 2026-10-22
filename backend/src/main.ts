import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.NODE_ENV === 'production'
      ? (process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)
      : true,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Othelio Agent API')
    .setDescription(
      'API interface for AI Agents, LLMs, and ChatGPT Actions to inspect, build, fund, and manage tokenized equity portfolios on Base.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Agent-Key', in: 'header' }, 'agent-key')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);

  app.getHttpAdapter().get('/reference/openapi.json', (_req: any, res: any) => {
    res.json(document);
  });

  app.use(
    '/reference',
    apiReference({
      spec: {
        content: document,
      },
      theme: 'kepler',
    }),
  );

  const host = process.env.API_HOST || '0.0.0.0';
  const port = parseInt(process.env.PORT || process.env.API_PORT || '3001', 10);

  await app.listen(port, host);
  console.log(`🚀 [NestJS Backend] Running on http://${host}:${port}`);
  console.log(`📖 [Scalar API Docs] Available on http://${host}:${port}/reference`);
}

bootstrap();
