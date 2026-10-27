import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import type { TelegramAdapters } from './bot/bot.js';
import { channelUrl, installiosPriceOf, supportUrl, type Env } from './config/env.js';
import type { AppDeps } from './http/app.js';
import type { Logger } from './lib/logger.js';
import { initDataSecret } from './lib/telegram-init-data.js';
import type { CatalogProvider } from './providers/catalog/catalog-provider.js';
import { InstalliosCatalogProvider } from './providers/catalog/installios-catalog-provider.js';
import { MockCatalogProvider } from './providers/catalog/mock-catalog-provider.js';
import type { DeliveryProvider } from './providers/delivery/delivery-provider.js';
import { MockDeliveryProvider } from './providers/delivery/mock-delivery-provider.js';
import { InstalliosClient } from './providers/installios/installios-client.js';
import { InstalliosDeliveryProvider } from './providers/installios/installios-delivery-provider.js';
import { CisPayProvider } from './providers/payment/cispay-provider.js';
import { MockPaymentProvider } from './providers/payment/mock-payment-provider.js';
import type { PaymentProvider } from './providers/payment/payment-provider.js';
import { createPrismaRepositories } from './repositories/prisma/prisma-repositories.js';
import type { Repositories } from './repositories/repositories.js';
import { ChannelInfoService } from './services/channel-info-service.js';
import { DeliveryService } from './services/delivery-service.js';
import { NotificationService } from './services/notification-service.js';
import { OrderService } from './services/order-service.js';
import { PartnerAdminService } from './services/partner-admin-service.js';
import { SubscriptionService } from './services/subscription-service.js';

const MINIAPP_DIST = fileURLToPath(new URL('../../miniapp/dist', import.meta.url));

export interface Container {
  db: PrismaClient;
  repos: Repositories;
  appDeps: AppDeps;
  subscription: SubscriptionService;
  /** null when the shop runs on mock catalog and delivery. */
  partnerAdmin: PartnerAdminService | null;
  /** Background jobs: start after the server listens, stop on shutdown. */
  background: { start(): void; stop(): void };
}

interface Supply {
  catalog: CatalogProvider;
  delivery: DeliveryProvider;
  installiosCatalog: InstalliosCatalogProvider | null;
  partnerAdmin: PartnerAdminService | null;
}

/** Catalog and delivery always come from the same source (checked in env). */
function createSupply(env: Env, logger: Logger): Supply {
  if (env.DELIVERY_PROVIDER !== 'installios' || !env.INSTALLIOS_API_KEY) {
    return {
      catalog: new MockCatalogProvider(),
      delivery: new MockDeliveryProvider(),
      installiosCatalog: null,
      partnerAdmin: null,
    };
  }
  const client = new InstalliosClient({ apiBase: env.INSTALLIOS_API_BASE, apiKey: env.INSTALLIOS_API_KEY, logger });
  const catalog = new InstalliosCatalogProvider({ client, priceOf: installiosPriceOf(env), logger });
  return {
    catalog,
    delivery: new InstalliosDeliveryProvider(client),
    installiosCatalog: catalog,
    partnerAdmin: new PartnerAdminService({ client, catalog }),
  };
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

export function createContainer(env: Env, telegram: TelegramAdapters, logger: Logger): Container {
  const db = new PrismaClient();
  const repos = createPrismaRepositories(db);
  const { catalog, delivery, installiosCatalog, partnerAdmin } = createSupply(env, logger);
  const { payments, mockPayments } = createPayments(env);

  const notifications = new NotificationService({
    sender: telegram.sender,
    adminIds: env.ADMIN_IDS,
    webAppUrl: env.WEBAPP_URL,
    logger,
  });
  const subscription = new SubscriptionService({
    channel: env.REQUIRED_CHANNEL,
    fetchMember: telegram.fetchMember,
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
    botToken: initDataSecret(env.BOT_TOKEN),
    trustProxyHops: env.TRUST_PROXY_HOPS,
    devUserId: env.DEV_USER_ID,
    allowedOrigin: new URL(env.WEBAPP_URL).origin,
    links: { channelUrl: channelUrl(env), supportUrl: supportUrl(env), termsUrl: env.TERMS_URL ?? null },
    channel: new ChannelInfoService({ channel: env.REQUIRED_CHANNEL, fetchChannel: telegram.fetchChannel, logger }),
    repos,
    catalog,
    payments,
    mockPayments,
    orders,
    delivery: new DeliveryService({ repos, delivery, logger }),
    subscription,
    miniappDir: env.SERVE_MINIAPP ? MINIAPP_DIST : null,
  };

  const background = {
    start: () => installiosCatalog?.start(),
    stop: () => installiosCatalog?.stop(),
  };

  return { db, repos, appDeps, subscription, partnerAdmin, background };
}
