import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Database } from '@magic/db';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { DATABASE } from './platform/database.module.js';

const config = loadConfig();

/**
 * The API binds to the internal network and is never routable from the internet. The BFF is the
 * only client, authenticating with a service token; the browser reaches it through Next.js route
 * handlers and never directly.
 */
const app = await NestFactory.create<NestFastifyApplication>(
  AppModule,
  new FastifyAdapter({
    genReqId: () => randomUUID(),
    trustProxy: true,
    bodyLimit: 2_097_152,
  }),
  { logger: config.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : ['error', 'warn', 'log', 'debug'] },
);

app.enableShutdownHooks();

const adapter = app.getHttpAdapter().getInstance();
adapter.get('/health', async () => ({ status: 'ok', service: 'api' }));

const database = app.get<Database>(DATABASE);
adapter.get('/health/ready', async (_request, reply) => {
  try {
    await database.execute(sql`SELECT 1`);
    return { status: 'ready', service: 'api' };
  } catch {
    return reply.code(503).send({ status: 'unavailable', service: 'api' });
  }
});

await app.listen({ port: config.API_PORT, host: config.API_HOST });
