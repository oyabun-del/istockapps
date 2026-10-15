import { existsSync } from 'node:fs';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { CatalogProvider } from '../providers/catalog/catalog-provider.js';
import type { MockPaymentProvider } from '../providers/payment/mock-payment-provider.js';
import type { PaymentProvider } from '../providers/payment/payment-provider.js';
import type { Repositories } from '../repositories/repositories.js';
import type { DeliveryService } from '../services/delivery-service.js';
import type { OrderService } from '../services/order-service.js';
import type { SubscriptionService } from '../services/subscription-service.js';
import type { TicketService } from '../services/ticket-service.js';
import { registerAuth } from './auth.js';
import { ok } from './envelope.js';
import { registerErrorHandling } from './error-handler.js';
import { registerApiRoutes } from './routes/api-routes.js';
import { devRoutes } from './routes/dev-routes.js';
import { webhookRoutes } from './routes/webhook-routes.js';

const GLOBAL_RATE_LIMIT = { max: 120, timeWindow: '1 minute' };
const BODY_LIMIT_BYTES = 64 * 1024;

export interface AppDeps {
  botToken: string;
  /** Reverse proxies in front of the app; 0 disables X-Forwarded-For trust. */
  trustProxyHops?: number;
  devUserId?: number;
  allowedOrigin: string;
  links: { channelUrl: string; supportUrl: string };
  repos: Repositories;
  catalog: CatalogProvider;
  payments: PaymentProvider;
  /** Set only when PAYMENT_PROVIDER=mock: enables the fake payment page. */
  mockPayments?: MockPaymentProvider;
  orders: OrderService;
  delivery: DeliveryService;
  tickets: TicketService;
  subscription: SubscriptionService;
  /** Built Mini App to serve from "/", if present. */
  miniappDir?: string | null;
}

export async function buildApp(deps: AppDeps, loggerInstance?: FastifyBaseLogger): Promise<FastifyInstance> {
  const app = Fastify({
    ...(loggerInstance ? { loggerInstance } : { logger: false }),
    bodyLimit: BODY_LIMIT_BYTES,
    // Trust X-Forwarded-For only from the configured number of proxy hops.
    trustProxy: (_address: string, hop: number) => hop < (deps.trustProxyHops ?? 0),
  });

  registerErrorHandling(app);
  await app.register(cors, { origin: deps.allowedOrigin, methods: ['GET', 'POST'] });
  await app.register(rateLimit, GLOBAL_RATE_LIMIT);

  app.addHook('onSend', async (_request, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
  });

  app.get('/health', async () => ok({ status: 'ok' }));

  await app.register(
    async (api) => {
      registerAuth(api, { botToken: deps.botToken, subscription: deps.subscription, devUserId: deps.devUserId });
      registerApiRoutes(api, deps);
    },
    { prefix: '/api' },
  );

  await app.register(webhookRoutes, { prefix: '/webhooks', payments: deps.payments, orders: deps.orders });

  if (deps.mockPayments) {
    await app.register(devRoutes, { prefix: '/dev', payments: deps.mockPayments, orders: deps.orders });
  }

  if (deps.miniappDir && existsSync(deps.miniappDir)) {
    await app.register(fastifyStatic, { root: deps.miniappDir, prefix: '/', index: 'index.html' });
  }

  return app;
}
