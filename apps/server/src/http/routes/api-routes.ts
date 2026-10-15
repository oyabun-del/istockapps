import type { MeDto, PaymentMethodDto } from '@istock/shared';
import {
  appIdParamSchema,
  catalogQuerySchema,
  createOrderSchema,
  createTicketSchema,
  orderIdParamSchema,
} from '@istock/shared/schemas';
import type { FastifyInstance } from 'fastify';
import { AppError, getErrorMessage } from '../../lib/app-error.js';
import type { CatalogProvider } from '../../providers/catalog/catalog-provider.js';
import type { Repositories } from '../../repositories/repositories.js';
import type { DeliveryService } from '../../services/delivery-service.js';
import type { OrderService } from '../../services/order-service.js';
import type { SubscriptionService } from '../../services/subscription-service.js';
import type { TicketService } from '../../services/ticket-service.js';
import { requireUser } from '../auth.js';
import { toOrderDto } from '../dto.js';
import { ok } from '../envelope.js';
import { parseInput } from '../validation.js';

const CODE_RATE_LIMIT = { max: 6, timeWindow: '1 minute' };
const CARD_MIN_KOPECKS = 5000;
const NO_STORE = 'no-store';

export interface ApiRoutesDeps {
  repos: Repositories;
  catalog: CatalogProvider;
  orders: OrderService;
  delivery: DeliveryService;
  tickets: TicketService;
  subscription: SubscriptionService;
  links: { channelUrl: string; supportUrl: string };
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
    const me: MeDto = {
      user: { id: user.id, firstName: user.firstName, username: user.username, photoUrl: user.photoUrl },
      isSubscribed: await deps.subscription.isSubscribed(user.id),
      ...deps.links,
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
    const dto: PaymentMethodDto[] = methods.map((method) => ({
      method,
      minAmountKopecks: method === 'CARD' ? CARD_MIN_KOPECKS : null,
    }));
    return ok(dto);
  });

  // ---------- Orders ----------
  app.post('/orders', async (request) => {
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

  app.get('/orders/:id/download', async (request, reply) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    reply.header('cache-control', NO_STORE);
    return ok({ url: await deps.delivery.getDownloadUrl(requireUser(request).id, id) });
  });

  app.post('/orders/:id/confirm-download', async (request) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    return ok(toOrderDto(await deps.delivery.confirmDownload(requireUser(request).id, id)));
  });

  app.post('/orders/:id/credentials', async (request, reply) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    reply.header('cache-control', NO_STORE);
    return ok(await deps.delivery.getCredentials(requireUser(request).id, id));
  });

  app.post('/orders/:id/code', { config: { rateLimit: CODE_RATE_LIMIT } }, async (request, reply) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    reply.header('cache-control', NO_STORE);
    return ok(await deps.delivery.requestCode(requireUser(request).id, id));
  });

  app.post('/orders/:id/complete', async (request) => {
    const { id } = parseInput(orderIdParamSchema, request.params);
    return ok(toOrderDto(await deps.delivery.complete(requireUser(request).id, id)));
  });

  // ---------- Support ----------
  app.post('/tickets', async (request) => {
    const input = parseInput(createTicketSchema, request.body);
    const ticket = await deps.tickets.create(requireUser(request), input);
    return ok({ id: ticket.id, createdAt: ticket.createdAt.toISOString() });
  });
}
