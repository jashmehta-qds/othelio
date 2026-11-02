import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';
import { AppModule } from './app.module.js';
import { AgentModule } from './agent/agent.module.js';

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
      'Autonomous & Human-in-the-Loop Agent API on Base. AI agents, LLMs, and ChatGPT Actions can inspect baskets, verify live Chainlink oracle prices, and stage bounded portfolio actions under strict user-enforced financial guardrails.',
    )
    .setVersion('1.0')
    .addApiKey({ type: 'apiKey', name: 'X-Agent-Key', in: 'header' }, 'agent-key')
    .addTag('Agent Interface', 'Endpoints for AI agents to query balances, assets, and stage bounded trades.')
    .addTag('Proposals & Execution', 'Endpoints to track proposal execution status and fetch review links.')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig, {
    include: [AgentModule],
  });

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
  const port = parseInt(process.env.API_PORT || process.env.PORT || '3001', 10);

  await app.listen(port, host);
  console.log(`🚀 [NestJS Backend] Running on http://${host}:${port}`);
  console.log(`📖 [Scalar API Docs] Available on http://${host}:${port}/reference`);
}

bootstrap();
