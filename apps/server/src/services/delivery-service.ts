import { randomUUID } from 'node:crypto';
import { isPaidStatus, type CodeWaitDto, type CredentialsDto, type DeliveryDto, type OrderStatus } from '@istock/shared';
import type { Order } from '../domain/models.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import {
  DeliveryAccessRevokedError,
  DeliveryExpiredError,
  DeliveryRateLimitedError,
  type CodeWait,
  type DeliveryProvider,
  type DeliverySnapshot,
  type GroupCredentials,
} from '../providers/delivery/delivery-provider.js';
import type { Repositories } from '../repositories/repositories.js';
import { isGroupUsable, toCodeWaitDto, toDeliveryDto } from './delivery-view.js';
import { getOwnedOrder } from './order-access.js';

/** The API asks for at most one status check per second for each wait. */
export const CODE_POLL_MIN_INTERVAL_MS = 1_000;
const POLL_CACHE_TTL_MS = 30_000;
const EXTERNAL_ID_PREFIX = 'istock-';
/** Credentials are re-read once when the groups changed between the two requests. */
const CREDENTIALS_ATTEMPTS = 2;

const CREDENTIAL_STATUSES: readonly OrderStatus[] = ['download_confirmed', 'credentials_issued', 'completed'];
const CODE_STATUSES: readonly OrderStatus[] = ['credentials_issued', 'completed'];

const NO_ACCESS_MESSAGE = 'Доступ к аккаунту сейчас недоступен. Обновите страницу: если идёт подбор замены, он займёт немного времени.';

export interface DeliveryServiceDeps {
  repos: Repositories;
  delivery: DeliveryProvider;
  logger: Logger;
  now?: () => Date;
}

interface CachedPoll {
  at: number;
  result: Promise<CodeWait>;
}

/** Stable per purchase: repeating the create call returns the same delivery. */
export function externalOrderId(order: Order): string {
  return `${EXTERNAL_ID_PREFIX}${order.paymentOrderId}`;
}

/**
 * Post-payment flow: delivery links → confirm → credentials → login code → complete.
 * Every view starts from a fresh delivery snapshot. Credentials and codes stay in memory only
 * and are never logged.
 */
export class DeliveryService {
  private readonly now: () => Date;
  private readonly refreshes = new Map<number, Promise<DeliverySnapshot>>();
  private readonly polls = new Map<string, CachedPoll>();

  constructor(private readonly deps: DeliveryServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  async getDelivery(userId: number, orderId: number): Promise<DeliveryDto> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (!isPaidStatus(order.status)) throw new AppError('INVALID_STATE', 'Заказ ещё не оплачен');
    return toDeliveryDto(await this.refresh(order), this.now());
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
    if (!CREDENTIAL_STATUSES.includes(order.status)) {
      throw new AppError('INVALID_STATE', 'Сначала скачайте приложение и подтвердите загрузку');
    }

    const groups = await this.readCredentials(order);
    if (groups.length === 0) throw new AppError('INVALID_STATE', NO_ACCESS_MESSAGE);

    if (order.status === 'download_confirmed') {
      const updated = await this.deps.repos.orders.transition(order.id, ['download_confirmed'], {
        status: 'credentials_issued',
      });
      if (updated) await this.deps.repos.orderEvents.add(order.id, 'credentials_issued');
    }
    return { groups: groups.map(({ groupId, login, password }) => ({ groupId, login, password })) };
  }

  /** Turns on the wait for a code; only after that may the buyer request the code on the iPhone. */
  async startCode(userId: number, orderId: number, groupId: string): Promise<CodeWaitDto> {
    const order = await this.codeOrder(userId, orderId);
    const snapshot = await this.refresh(order);
    const group = snapshot.groups.find((item) => item.id === groupId);
    if (!group || !isGroupUsable(group, snapshot, this.now())) {
      throw new AppError('INVALID_STATE', 'Эта выдача больше не действует. Обновите страницу.');
    }
    if (group.codesUsed >= group.codesLimit) {
      throw new AppError('TOO_MANY_REQUESTS', 'Лимит кодов для этого аккаунта исчерпан. Напишите в поддержку.');
    }

    const latest = await this.deps.repos.codeWaits.findLatest(order.id, groupId);
    if (latest?.waitId) {
      // A second tap while the previous wait is still running resumes it instead of starting another.
      const current = await this.pollWait(order, latest.waitId).catch(() => null);
      if (current?.status === 'active') return toCodeWaitDto(current, groupId, this.now());
    }

    // An attempt the API never confirmed is retried with its own key, so it cannot start twice.
    const attempt =
      latest && !latest.waitId
        ? latest
        : await this.deps.repos.codeWaits.create({
            orderId: order.id,
            groupId,
            idempotencyKey: `${EXTERNAL_ID_PREFIX}${order.id}-${randomUUID()}`,
          });
    const wait = await this.callProvider(order, 'code_wait_start', () =>
      this.deps.delivery.startCodeWait(snapshot.ref, groupId, attempt.idempotencyKey),
    );
    await this.deps.repos.codeWaits.setWaitId(attempt.id, wait.id);
    await this.saveExpiry(order, wait.orderExpiresAt);
    await this.deps.repos.orderEvents.add(order.id, 'code_wait_started');
    return toCodeWaitDto(wait, groupId, this.now());
  }

  async getCodeWait(userId: number, orderId: number, waitId: string): Promise<CodeWaitDto> {
    const order = await this.codeOrder(userId, orderId);
    const attempt = await this.deps.repos.codeWaits.findByWaitId(order.id, waitId);
    if (!attempt) throw new AppError('NOT_FOUND', 'Ожидание кода не найдено');
    const wait = await this.pollWait(order, waitId);
    await this.saveExpiry(order, wait.orderExpiresAt);
    if (wait.status === 'succeeded') await this.markCodeStepDone(order, 'code_received');
    return toCodeWaitDto(wait, attempt.groupId, this.now());
  }

  /** Apple does not always ask for a code: the buyer may finish the code step without one. */
  async skipCode(userId: number, orderId: number): Promise<Order> {
    const order = await this.codeOrder(userId, orderId);
    return this.markCodeStepDone(order, 'code_skipped');
  }

  async complete(userId: number, orderId: number): Promise<Order> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (order.status === 'completed') return order;
    if (order.status === 'credentials_issued' && !order.codeReceivedAt) {
      throw new AppError('INVALID_STATE', 'Сначала введите код подтверждения');
    }
    const updated = await this.deps.repos.orders.transition(order.id, ['credentials_issued'], {
      status: 'completed',
      completedAt: this.now(),
    });
    if (!updated) throw new AppError('INVALID_STATE', 'Сначала войдите в аккаунт по выданным данным');
    await this.deps.repos.orderEvents.add(order.id, 'completed');
    return updated;
  }

  private async codeOrder(userId: number, orderId: number): Promise<Order> {
    const order = await getOwnedOrder(this.deps.repos.orders, userId, orderId);
    if (!CODE_STATUSES.includes(order.status)) {
      throw new AppError('INVALID_STATE', 'Код доступен после получения данных для входа');
    }
    return order;
  }

  /** Unlocks the last step once; repeated calls keep the first time. */
  private async markCodeStepDone(order: Order, event: 'code_received' | 'code_skipped'): Promise<Order> {
    if (order.codeReceivedAt) return order;
    const updated = await this.deps.repos.orders.update(order.id, { codeReceivedAt: this.now() });
    await this.deps.repos.orderEvents.add(order.id, event);
    return updated;
  }

  /** Fresh credentials matched by the ids of the groups that are usable right now. */
  private async readCredentials(order: Order): Promise<GroupCredentials[]> {
    for (let attempt = 1; ; attempt += 1) {
      const snapshot = await this.refresh(order);
      const usable = new Set(
        snapshot.groups.filter((group) => isGroupUsable(group, snapshot, this.now())).map((group) => group.id),
      );
      if (usable.size === 0) return [];

      const credentials = await this.callProvider(order, 'credentials', () =>
        this.deps.delivery.getCredentials(snapshot.ref),
      );
      const shown = credentials.filter(
        (item) => usable.has(item.groupId) && !item.isRevoked && item.login !== '' && item.password !== '',
      );
      const isConsistent = shown.length === usable.size;
      if (isConsistent || attempt >= CREDENTIALS_ATTEMPTS) return shown;
    }
  }

  /** One refresh per order at a time; concurrent callers share its result. */
  private refresh(order: Order): Promise<DeliverySnapshot> {
    const running = this.refreshes.get(order.id);
    if (running) return running;
    const task = this.loadSnapshot(order).finally(() => this.refreshes.delete(order.id));
    this.refreshes.set(order.id, task);
    return task;
  }

  private async loadSnapshot(order: Order): Promise<DeliverySnapshot> {
    const { delivery } = this.deps;
    const ref = order.deliveryRef;
    const snapshot = await this.callProvider(order, 'delivery', () =>
      ref
        ? delivery.getDelivery(ref)
        : delivery.createDelivery(
            externalOrderId(order),
            order.items.map((item) => item.appId),
          ),
    );
    const isNew = ref !== snapshot.ref;
    if (isNew || order.deliveryExpiresAt?.getTime() !== snapshot.expiresAt.getTime()) {
      await this.deps.repos.orders.update(order.id, { deliveryRef: snapshot.ref, deliveryExpiresAt: snapshot.expiresAt });
    }
    if (isNew) await this.deps.repos.orderEvents.add(order.id, 'delivery_created', { sandbox: snapshot.isSandbox });
    return snapshot;
  }

  /** Reuses a status read younger than a second, so polling never exceeds the API's rate. */
  private pollWait(order: Order, waitId: string): Promise<CodeWait> {
    const nowMs = this.now().getTime();
    for (const [id, cached] of this.polls) {
      if (nowMs - cached.at > POLL_CACHE_TTL_MS) this.polls.delete(id);
    }
    const cached = this.polls.get(waitId);
    if (cached && nowMs - cached.at < CODE_POLL_MIN_INTERVAL_MS) return cached.result;

    const result = this.callProvider(order, 'code_wait_status', () => this.deps.delivery.getCodeWait(waitId));
    const entry = { at: nowMs, result };
    this.polls.set(waitId, entry);
    // A failed read is not reused, but never evict a newer read that replaced it.
    result.catch(() => {
      if (this.polls.get(waitId) === entry) this.polls.delete(waitId);
    });
    return result;
  }

  private async saveExpiry(order: Order, expiresAt: Date | null): Promise<void> {
    if (!expiresAt || order.deliveryExpiresAt?.getTime() === expiresAt.getTime()) return;
    await this.deps.repos.orders.update(order.id, { deliveryExpiresAt: expiresAt });
  }

  private async callProvider<T>(order: Order, step: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error: unknown) {
      throw this.toAppError(order, step, error);
    }
  }

  private toAppError(order: Order, step: string, error: unknown): AppError {
    if (error instanceof DeliveryAccessRevokedError) {
      return new AppError('INVALID_STATE', 'Доступ к этому аккаунту отозван. Обновите страницу.', { cause: error });
    }
    if (error instanceof DeliveryExpiredError) {
      return new AppError('INVALID_STATE', 'Срок выдачи истёк. Напишите в поддержку.', { cause: error });
    }
    if (error instanceof DeliveryRateLimitedError) {
      const wait = error.retryAfterSeconds ? ` через ${error.retryAfterSeconds} с` : ' чуть позже';
      return new AppError('TOO_MANY_REQUESTS', `Слишком много запросов. Попробуйте${wait}.`, { cause: error });
    }
    this.deps.logger.error({ orderId: order.id, step, err: getErrorMessage(error) }, 'Delivery provider failed');
    return new AppError('DELIVERY_PROVIDER_ERROR', 'Сервис выдачи временно недоступен. Попробуйте позже.', {
      cause: error,
    });
  }
}
