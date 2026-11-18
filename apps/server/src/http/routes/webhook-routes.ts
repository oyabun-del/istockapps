import type { FastifyInstance } from 'fastify';
import type { PaymentRoute } from '../../providers/payment/payment-router.js';
import type { OrderService } from '../../services/order-service.js';
import { fail, ok } from '../envelope.js';

export interface WebhookRoutesDeps {
  /** Each provider gets /webhooks/<name>; its callbacks may only touch orders of its methods. */
  sources: readonly PaymentRoute[];
  orders: OrderService;
}

/** Must be registered in its own encapsulated scope: it replaces the JSON parser with a raw one. */
export async function webhookRoutes(app: FastifyInstance, deps: WebhookRoutesDeps): Promise<void> {
  // PaymentProvider.parseWebhook takes the exact bytes, so keep the body raw.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  for (const { name, provider, methods } of deps.sources) {
    app.post(`/${name}`, async (request, reply) => {
      const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
      const result = provider.parseWebhook(raw, request.headers);
      if (result.kind === 'unauthorized') {
        request.log.warn({ provider: name }, 'Rejected payment callback: bad credentials');
        return reply.status(401).send(fail('UNAUTHORIZED', 'Invalid credentials'));
      }
      if (result.kind === 'malformed') {
        // Authentic, so possibly a refund we can no longer see: paid orders are not polled afterwards.
        request.log.error({ provider: name, reason: result.reason }, 'Unreadable payment callback: check the callback format');
        return reply.status(400).send(fail('VALIDATION_ERROR', 'Malformed callback'));
      }
      if (result.kind === 'ignored') {
        request.log.info({ provider: name, reason: result.reason }, 'Payment callback ignored');
        return ok({ received: true });
      }

      const { webhook } = result;
      request.log.info(
        { provider: name, paymentId: webhook.paymentId, status: webhook.status, sandbox: webhook.isSandbox },
        'Payment callback received',
      );
      // Errors propagate → 5xx → the provider retries the callback later.
      await deps.orders.handlePaymentWebhook(webhook.orderId, webhook, methods);
      return ok({ received: true });
    });
  }
}
