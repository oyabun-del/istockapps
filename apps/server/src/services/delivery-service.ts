import { isPaidStatus, type CodeDto, type CredentialsDto } from '@istock/shared';
import type { Order } from '../domain/models.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { DeliveryProvider } from '../providers/delivery/delivery-provider.js';
import type { Repositories } from '../repositories/repositories.js';
import { getOwnedOrder } from './order-access.js';

export const CODE_COOLDOWN_MS = 30_000;
export const MAX_CODE_REQUESTS = 10;

export interface DeliveryServiceDeps {
  repos: Repositories;
  delivery: DeliveryProvider;
  logger: Logger;
  now?: () => Date;
}

/**
 * Post-payment flow: download → confirm → credentials → login code → complete.
 * Credentials and codes are never logged.
 */
export class DeliveryService {
  private readonly now: () => Date;

  constructor(private readonly deps: DeliveryServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async getDownloadUrl(userId: number, orderId: number): Promise<string> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (!isPaidStatus(order.status)) throw new AppError('INVALID_STATE', 'Заказ ещё не оплачен');
    const url = await this.callProvider(order, 'download', () => this.deps.delivery.getDownloadUrl(order));
    await this.deps.repos.orderEvents.add(order.id, 'download_link_issued');
    return url;
  }

  async confirmDownload(userId: number, orderId: number): Promise<Order> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (order.status !== 'paid') {
      if (isPaidStatus(order.status)) return order; // already confirmed: idempotent
      throw new AppError('INVALID_STATE', 'Заказ ещё не оплачен');
    }
    const updated = await this.deps.repos.orders.transition(order.id, ['paid'], { status: 'download_confirmed' });
    if (updated) await this.deps.repos.orderEvents.add(order.id, 'download_confirmed');
    return updated ?? (await getOwnedOrder(this.deps.repos.orders, userId, orderId));
  }

  async getCredentials(userId: number, orderId: number): Promise<CredentialsDto> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    const allowed = ['download_confirmed', 'credentials_issued', 'completed'];
    if (!allowed.includes(order.status)) {
      throw new AppError('INVALID_STATE', 'Сначала скачайте приложение и подтвердите загрузку');
    }

    const credentials = await this.callProvider(order, 'credentials', () => this.deps.delivery.getCredentials(order));
    if (order.status === 'download_confirmed') {
      const updated = await this.deps.repos.orders.transition(order.id, ['download_confirmed'], {
        status: 'credentials_issued',
      });
      if (updated) await this.deps.repos.orderEvents.add(order.id, 'credentials_issued');
    }
    return { login: credentials.login, password: credentials.password };
  }

  async requestCode(userId: number, orderId: number): Promise<CodeDto> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (order.status !== 'credentials_issued' && order.status !== 'completed') {
      throw new AppError('INVALID_STATE', 'Код доступен после получения данных для входа');
    }
    if (order.codeRequests >= MAX_CODE_REQUESTS) {
      throw new AppError('TOO_MANY_REQUESTS', 'Лимит запросов кода исчерпан. Напишите в поддержку.');
    }

    const now = this.now();
    if (order.lastCodeAt && now.getTime() - order.lastCodeAt.getTime() < CODE_COOLDOWN_MS) {
      throw new AppError('TOO_MANY_REQUESTS', 'Подождите немного перед повторным запросом кода');
    }

    const recorded = await this.deps.repos.orders.recordCodeRequest(order.id, order.codeRequests, now);
    if (!recorded) throw new AppError('TOO_MANY_REQUESTS', 'Код уже запрошен, подождите немного');

    const { code, ttlSeconds } = await this.callProvider(order, 'code', () => this.deps.delivery.requestLoginCode(order));
    await this.deps.repos.orderEvents.add(order.id, 'code_issued', { attempt: recorded.codeRequests });
    return {
      code,
      nextRequestAt: new Date(now.getTime() + CODE_COOLDOWN_MS).toISOString(),
      // Our clock, not the API's: the TTL is relative, so clock skew between servers does not matter.
      expiresAt: ttlSeconds === null ? null : new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    };
  }

  async complete(userId: number, orderId: number): Promise<Order> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (order.status === 'completed') return order;
    const updated = await this.deps.repos.orders.transition(order.id, ['credentials_issued'], {
      status: 'completed',
      completedAt: this.now(),
    });
    if (!updated) throw new AppError('INVALID_STATE', 'Сначала войдите в аккаунт по выданным данным');
    await this.deps.repos.orderEvents.add(order.id, 'completed');
    return updated;
  }

  private async callProvider<T>(order: Order, step: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error: unknown) {
      this.deps.logger.error({ orderId: order.id, step, err: getErrorMessage(error) }, 'Delivery provider failed');
      throw new AppError('DELIVERY_PROVIDER_ERROR', 'Сервис выдачи временно недоступен. Попробуйте позже.', {
        cause: error,
      });
    }
  }
}
