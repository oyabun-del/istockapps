import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { User } from '../domain/models.js';
import { AppError } from '../lib/app-error.js';
import { validateInitData } from '../lib/telegram-init-data.js';
import type { SubscriptionService } from '../services/subscription-service.js';

declare module 'fastify' {
  interface FastifyRequest {
    tgUser: User | null;
  }
  interface FastifyContextConfig {
    /** Routes reachable without a channel subscription (e.g. the subscription check itself). */
    skipSubscription?: boolean;
  }
}

const AUTH_SCHEME = 'tma ';

export interface AuthOptions {
  botToken: string;
  subscription: SubscriptionService;
  /** Development only: user assumed when the request has no initData. */
  devUserId?: number;
}

export function requireUser(request: FastifyRequest): User {
  if (!request.tgUser) throw new AppError('UNAUTHORIZED', 'Откройте магазин через Telegram');
  return request.tgUser;
}

function resolveUser(request: FastifyRequest, options: AuthOptions): User {
  const header = request.headers.authorization;
  if (!header && options.devUserId !== undefined) {
    return { id: options.devUserId, firstName: 'Dev', lastName: null, username: 'dev', photoUrl: null };
  }
  if (!header?.startsWith(AUTH_SCHEME)) throw new AppError('UNAUTHORIZED', 'Откройте магазин через Telegram');

  const result = validateInitData(header.slice(AUTH_SCHEME.length), options.botToken);
  if (!result.ok) {
    request.log.warn({ reason: result.reason }, 'Rejected initData');
    throw new AppError('UNAUTHORIZED', 'Сессия устарела. Перезапустите магазин.');
  }
  return result.data.user;
}

/** Registers initData auth + subscription gate for every route in the given scope. */
export function registerAuth(app: FastifyInstance, options: AuthOptions): void {
  app.decorateRequest('tgUser', null);
  app.addHook('preHandler', async (request) => {
    request.tgUser = resolveUser(request, options);
    if (request.routeOptions.config.skipSubscription) return;
    const isSubscribed = await options.subscription.isSubscribed(request.tgUser.id);
    if (!isSubscribed) throw new AppError('NOT_SUBSCRIBED', 'Подпишитесь на канал, чтобы пользоваться магазином');
  });
}
