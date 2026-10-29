import type { MeDto, PaymentMethodDto } from '@istock/shared';
import {
  appIdParamSchema,
  catalogQuerySchema,
  codeWaitParamSchema,
  createOrderSchema,
  orderIdParamSchema,
  startCodeSchema,
} from '@istock/shared/schemas';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError, getErrorMessage } from '../../lib/app-error.js';
import type { CatalogProvider } from '../../providers/catalog/catalog-provider.js';
import type { Repositories } from '../../repositories/repositories.js';
import type { ChannelInfoService } from '../../services/channel-info-service.js';
import type { DeliveryService } from '../../services/delivery-service.js';
import type { OrderService } from '../../services/order-service.js';
import type { SubscriptionService } from '../../services/subscription-service.js';
import { requireUser } from '../auth.js';
import { toOrderDto } from '../dto.js';
import { ok } from '../envelope.js';
import { parseInput } from '../validation.js';

const CODE_RATE_LIMIT = { max: 6, timeWindow: '1 minute' };
/** The Mini App polls a running wait about once a second for up to five minutes. */
const CODE_POLL_RATE_LIMIT = { max: 90, timeWindow: '1 minute' };
const NO_STORE = 'no-store';

/**
 * Keyed by buyer, not by IP: each of these calls opens a CISPAY invoice or reads the Install-IOS API,
 * so one buyer must not exhaust the partner limits for everyone (or a shared NAT for its neighbours).
 * Runs after auth (preHandler), when the buyer is known.
 */
function perBuyer(max: number) {
  return {
    max,
    timeWindow: '1 minute',
    hook: 'preHandler' as const,
    keyGenerator: (request: FastifyRequest) => (request.tgUser ? `user:${request.tgUser.id}` : `ip:${request.ip}`),
  };
}

const ORDER_CREATE_RATE_LIMIT = perBuyer(10);
const DELIVERY_READ_RATE_LIMIT = perBuyer(30);

export interface ApiRoutesDeps {
  repos: Repositories;
  catalog: CatalogProvider;
  orders: OrderService;
  delivery: DeliveryService;
  subscription: SubscriptionService;
  links: { channelUrl: string; supportUrl: string; termsUrl: string | null };
  channel: ChannelInfoService;
}

async function callCatalog<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error: unknown) {
    throw new AppError('CATALOG_PROVIDER_ERROR', 'Каталог временно недоступен', {
      cause: new Error(getErrorMessage(error)),
    });
  }
}

export function registerApiRoutes(app: FastifyInstance, deps: ApiRoutesDeps): void {
  // ---------- Session ----------
  app.get('/me', { config: { skipSubscription: true } }, async (request) => {
    const user = requireUser(request);
    await deps.repos.users.upsert(user);
    const [isSubscribed, channel] = await Promise.all([
      deps.subscription.isSubscribed(user.id),
      deps.channel.getInfo(),
    ]);
    const me: MeDto = {
      user: { id: user.id, firstName: user.firstName, username: user.username, photoUrl: user.photoUrl },
      isSubscribed,
      ...deps.links,
      channel,
    };
    return ok(me);
  });

  app.post('/me/subscription/check', { config: { skipSubscription: true } }, async (request) => {
    const user = requireUser(request);
    return ok({ isSubscribed: await deps.subscription.isSubscribed(user.id, { force: true }) });
  });

  // ---------- Catalog ----------
  app.get('/catalog/categories', async () => ok(await callCatalog(() => deps.catalog.listCategories())));

  app.get('/catalog/apps', async (request) => {
    const query = parseInput(catalogQuerySchema, request.query);
    return ok(await callCatalog(() => deps.catalog.listApps(query)));
  });

  app.get('/catalog/apps/:appId', async (request) => {
    const { appId } = parseInput(appIdParamSchema, request.params);
    const found = await callCatalog(() => deps.catalog.getApp(appId));
    if (!found) throw new AppError('NOT_FOUND', 'Приложение не найдено');
    return ok(found);
  });

  app.get('/payment-methods', async () => {
    const methods = await deps.orders.listPaymentMethods();
    const dto: PaymentMethodDto[] = methods.map((method) => ({ method }));
    return ok(dto);
  });

  // ---------- Orders ----------
  app.post('/orders', { config: { rateLimit: ORDER_CREATE_RATE_LIMIT } }, async (request) => {
    const input = parseInput(createOrderSchema, request.body);
    const order = await deps.orders.createOrder(requireUser(request), input);
    return ok(toOrderDto(order));
  });

  app.get('/orders', async (request) => {
    const orders = await deps.orders.listOrders(requireUser(request).id);
    return ok(orders.map(toOrderDto));
  });

  app.get('/orders/:id', async (request) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    return ok(toOrderDto(await deps.orders.getOrder(requireUser(request).id, id)));
  });

  app.post('/orders/:id/cancel', async (request) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    return ok(toOrderDto(await deps.orders.cancelOrder(requireUser(request).id, id)));
  });

  app.get('/orders/:id/delivery', { config: { rateLimit: DELIVERY_READ_RATE_LIMIT } }, async (request, reply) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    reply.header('cache-control', NO_STORE);
    return ok(await deps.delivery.getDelivery(requireUser(request).id, id));
  });

  app.post('/orders/:id/confirm-download', async (request) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    return ok(toOrderDto(await deps.delivery.confirmDownload(requireUser(request).id, id)));
  });

  app.post('/orders/:id/credentials', { config: { rateLimit: DELIVERY_READ_RATE_LIMIT } }, async (request, reply) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    reply.header('cache-control', NO_STORE);
    return ok(await deps.delivery.getCredentials(requireUser(request).id, id));
  });

  app.post('/orders/:id/code', { config: { rateLimit: CODE_RATE_LIMIT } }, async (request, reply) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    const { groupId } = parseInput(startCodeSchema, request.body);
    reply.header('cache-control', NO_STORE);
    return ok(await deps.delivery.startCode(requireUser(request).id, id, groupId));
  });

  app.get('/orders/:id/code/:waitId', { config: { rateLimit: CODE_POLL_RATE_LIMIT } }, async (request, reply) => {
    const { id, waitId } = parseInput(codeWaitParamSchema, request.params);
    reply.header('cache-control', NO_STORE);
    return ok(await deps.delivery.getCodeWait(requireUser(request).id, id, waitId));
  });

  app.post('/orders/:id/skip-code', async (request) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    return ok(toOrderDto(await deps.delivery.skipCode(requireUser(request).id, id)));
  });

  app.post('/orders/:id/complete', async (request) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    return ok(toOrderDto(await deps.delivery.complete(requireUser(request).id, id)));
  });

}
