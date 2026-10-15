import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { Bot } from 'grammy';
import { createChannelFetcher, createChatMemberFetcher, createMessageSender } from './bot/bot.js';
import { channelUrl, supportUrl, type Env } from './config/env.js';
import type { AppDeps } from './http/app.js';
import type { Logger } from './lib/logger.js';
import { MockCatalogProvider } from './providers/catalog/mock-catalog-provider.js';
import { MockDeliveryProvider } from './providers/delivery/mock-delivery-provider.js';
import { CisPayProvider } from './providers/payment/cispay-provider.js';
import { MockPaymentProvider } from './providers/payment/mock-payment-provider.js';
import type { PaymentProvider } from './providers/payment/payment-provider.js';
import { createPrismaRepositories } from './repositories/prisma/prisma-repositories.js';
import type { Repositories } from './repositories/repositories.js';
import { ChannelInfoService } from './services/channel-info-service.js';
import { DeliveryService } from './services/delivery-service.js';
import { NotificationService } from './services/notification-service.js';
import { OrderService } from './services/order-service.js';
import { SubscriptionService } from './services/subscription-service.js';
import { TicketService } from './services/ticket-service.js';

const MINIAPP_DIST = fileURLToPath(new URL('../../miniapp/dist', import.meta.url));

export interface Container {
  db: PrismaClient;
  repos: Repositories;
  appDeps: AppDeps;
  subscription: SubscriptionService;
}

function createPayments(env: Env): { payments: PaymentProvider; mockPayments?: MockPaymentProvider } {
  if (env.PAYMENT_PROVIDER === 'cispay' && env.CISPAY_SHOP_ID && env.CISPAY_API_KEY) {
    return {
      payments: new CisPayProvider({ apiUrl: env.CISPAY_API_URL, shopId: env.CISPAY_SHOP_ID, apiKey: env.CISPAY_API_KEY }),
    };
  }
  const mockPayments = new MockPaymentProvider(env.PUBLIC_URL);
  return { payments: mockPayments, mockPayments };
}

export function createContainer(env: Env, bot: Bot, logger: Logger): Container {
  const db = new PrismaClient();
  const repos = createPrismaRepositories(db);
  const catalog = new MockCatalogProvider();
  const delivery = new MockDeliveryProvider();
  const { payments, mockPayments } = createPayments(env);

  const notifications = new NotificationService({
    sender: createMessageSender(bot),
    adminIds: env.ADMIN_IDS,
    webAppUrl: env.WEBAPP_URL,
    logger,
  });
  const subscription = new SubscriptionService({
    channel: env.REQUIRED_CHANNEL,
    fetchMember: createChatMemberFetcher(bot),
    logger,
  });
  const orders = new OrderService({
    repos,
    catalog,
    payments,
    notifications,
    logger,
    returnUrl: (order) => (env.BOT_USERNAME ? `https://t.me/${env.BOT_USERNAME}?start=${order.id}` : null),
    acceptSandboxPayments: env.NODE_ENV !== 'production' || env.ALLOW_SANDBOX_PAYMENTS,
  });

  const appDeps: AppDeps = {
    botToken: env.BOT_TOKEN,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    devUserId: env.DEV_USER_ID,
    allowedOrigin: new URL(env.WEBAPP_URL).origin,
    links: { channelUrl: channelUrl(env), supportUrl: supportUrl(env), termsUrl: env.TERMS_URL ?? null },
    channel: new ChannelInfoService({ channel: env.REQUIRED_CHANNEL, fetchChannel: createChannelFetcher(bot), logger }),
    repos,
    catalog,
    payments,
    mockPayments,
    orders,
    delivery: new DeliveryService({ repos, delivery, logger }),
    tickets: new TicketService({ repos, notifications }),
    subscription,
    miniappDir: env.SERVE_MINIAPP ? MINIAPP_DIST : null,
  };

  return { db, repos, appDeps, subscription };
}
