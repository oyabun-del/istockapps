import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';

/** Subset of the Bot API ChatMember object. */
export interface ChatMemberInfo {
  status: string;
  /** Present only for status "restricted". */
  isMember?: boolean;
}

export type ChatMemberFetcher = (chatId: string, userId: number) => Promise<ChatMemberInfo>;

const SUBSCRIBED_STATUSES = new Set(['creator', 'administrator', 'member']);

export function isSubscribedMember(member: ChatMemberInfo): boolean {
  if (member.status === 'restricted') return member.isMember === true;
  return SUBSCRIBED_STATUSES.has(member.status);
}

export const SUBSCRIPTION_CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 10_000;

export interface SubscriptionServiceDeps {
  channel: string;
  fetchMember: ChatMemberFetcher;
  logger: Logger;
  now?: () => number;
}

export class SubscriptionService {
  private readonly cache = new Map<number, { isSubscribed: boolean; expiresAt: number }>();
  /** Parallel API calls on app start share one getChatMember request. */
  private readonly inFlight = new Map<number, Promise<boolean>>();
  private readonly now: () => number;

  constructor(private readonly deps: SubscriptionServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** `force` skips the cache (used by the "Я подписался" button). */
  async isSubscribed(userId: number, options: { force?: boolean } = {}): Promise<boolean> {
    const cached = this.cache.get(userId);
    if (!options.force && cached && cached.expiresAt > this.now()) return cached.isSubscribed;

    const pending = this.inFlight.get(userId);
    if (pending) return pending;
    const request = this.fetchSubscription(userId).finally(() => this.inFlight.delete(userId));
    this.inFlight.set(userId, request);
    return request;
  }

  private async fetchSubscription(userId: number): Promise<boolean> {
    let member: ChatMemberInfo;
    try {
      member = await this.deps.fetchMember(this.deps.channel, userId);
    } catch (error: unknown) {
      // Usually means the bot is not an admin of the channel.
      this.deps.logger.error({ userId, err: getErrorMessage(error) }, 'Subscription check failed');
      throw new AppError('SUBSCRIPTION_CHECK_FAILED', 'Не удалось проверить подписку. Попробуйте позже.', {
        cause: error,
      });
    }

    const isSubscribed = isSubscribedMember(member);
    this.remember(userId, isSubscribed);
    return isSubscribed;
  }

  private remember(userId: number, isSubscribed: boolean): void {
    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(userId, { isSubscribed, expiresAt: this.now() + SUBSCRIPTION_CACHE_TTL_MS });
  }
}
