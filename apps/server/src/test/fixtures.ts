import type { User } from '../domain/models.js';
import { silentLogger } from '../lib/logger.js';
import { MockCatalogProvider } from '../providers/catalog/mock-catalog-provider.js';
import { MockDeliveryProvider } from '../providers/delivery/mock-delivery-provider.js';
import { MockPaymentProvider } from '../providers/payment/mock-payment-provider.js';
import { createMemoryRepositories, type MemoryRepositories } from '../repositories/memory/memory-repositories.js';
import { ChannelInfoService } from '../services/channel-info-service.js';
import { CheckoutGate } from '../services/checkout-gate.js';
import { DeliveryService } from '../services/delivery-service.js';
import { NotificationService, type MessageButton, type MessageSender } from '../services/notification-service.js';
import { OrderService } from '../services/order-service.js';
import { SubscriptionService, type ChatMemberInfo } from '../services/subscription-service.js';

export const BOT_TOKEN = '123456:TEST-token-abcdefghijklmnopqrstuvwxyz';
export const ADMIN_IDS = [111, 222];
export const WEBAPP_URL = 'https://shop.example.com';

export const BUYER: User = { id: 42, firstName: 'Иван', lastName: null, username: 'ivan', photoUrl: null };
export const OTHER_USER: User = { id: 43, firstName: 'Пётр', lastName: null, username: null, photoUrl: null };

export interface SentMessage {
  chatId: number;
  html: string;
  button?: MessageButton;
}

export class FakeSender implements MessageSender {
  readonly sent: SentMessage[] = [];
  failFor = new Set<number>();

  async send(chatId: number, html: string, button?: MessageButton): Promise<void> {
    if (this.failFor.has(chatId)) throw new Error(`chat ${chatId} unavailable`);
    this.sent.push({ chatId, html, button });
  }
}

export class Clock {
  constructor(public current = new Date('2026-10-14T12:00:00Z')) {}
  now = (): Date => new Date(this.current);
  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }
}

export interface TestContext {
  repos: MemoryRepositories;
  sender: FakeSender;
  clock: Clock;
  payments: MockPaymentProvider;
  catalog: MockCatalogProvider;
  delivery: MockDeliveryProvider;
  members: Map<number, ChatMemberInfo>;
  subscription: SubscriptionService;
  channel: ChannelInfoService;
  notifications: NotificationService;
  checkout: CheckoutGate;
  orders: OrderService;
  deliveryService: DeliveryService;
}

export function createTestContext(): TestContext {
  const clock = new Clock();
  const repos = createMemoryRepositories(clock.now);
  const sender = new FakeSender();
  const payments = new MockPaymentProvider('https://api.example.com');
  const catalog = new MockCatalogProvider();
  const delivery = new MockDeliveryProvider(clock.now);
  const members = new Map<number, ChatMemberInfo>();

  const notifications = new NotificationService({ sender, adminIds: ADMIN_IDS, webAppUrl: WEBAPP_URL, logger: silentLogger });
  const subscription = new SubscriptionService({
    channel: '@test_channel',
    fetchMember: async (_chat, userId) => members.get(userId) ?? { status: 'left' },
    logger: silentLogger,
    now: () => clock.current.getTime(),
  });
  const channel = new ChannelInfoService({
    channel: '@test_channel',
    fetchChannel: async () => ({ title: 'iStockApps', memberCount: 42_800 }),
    logger: silentLogger,
    now: () => clock.current.getTime(),
  });
  const checkout = new CheckoutGate({ repos, now: clock.now });
  const orders = new OrderService({
    repos,
    catalog,
    payments,
    notifications,
    checkout,
    logger: silentLogger,
    returnUrl: (order) => `https://t.me/test_bot?start=${order.id}`,
    acceptSandboxPayments: true,
    now: clock.now,
  });
  const deliveryService = new DeliveryService({ repos, delivery, logger: silentLogger, now: clock.now });

  return {
    repos,
    sender,
    clock,
    payments,
    catalog,
    delivery,
    members,
    subscription,
    channel,
    notifications,
    checkout,
    orders,
    deliveryService,
  };
}

/** Creates an order and marks it paid through the payment webhook path. */
export async function createPaidOrder(ctx: TestContext, appIds: readonly string[] = ['sberbank']) {
  const order = await ctx.orders.createOrder(BUYER, { appIds: [...appIds], paymentMethod: 'SBP' });
  const payment = ctx.payments.setStatus(order.paymentId as string, 'PAID');
  if (!payment) throw new Error('payment missing');
  await ctx.orders.handlePaymentWebhook(order.paymentOrderId, { ...payment, isSandbox: false });
  const paid = await ctx.repos.orders.findById(order.id);
  if (!paid) throw new Error('order missing');
  return paid;
}
