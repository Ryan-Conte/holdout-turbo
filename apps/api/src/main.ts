import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: process.env.CORS_ORIGIN ?? 'http://localhost:3000' });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`[holdout-api] listening on http://localhost:${port}`);
}
bootstrap();
