import type { FastifyInstance } from 'fastify';
import type { PaymentProvider } from '../../providers/payment/payment-provider.js';
import type { OrderService } from '../../services/order-service.js';
import { fail, ok } from '../envelope.js';

export interface WebhookRoutesDeps {
  payments: PaymentProvider;
  orders: OrderService;
}

/** Must be registered in its own encapsulated scope: it replaces the JSON parser with a raw one. */
export async function webhookRoutes(app: FastifyInstance, deps: WebhookRoutesDeps): Promise<void> {
  // Signature is computed over the exact bytes, so keep the body raw.
  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  app.post('/cispay', async (request, reply) => {
    const raw = Buffer.isBuffer(request.body) ? request.body : Buffer.alloc(0);
    const webhook = deps.payments.parseWebhook(raw, request.headers);
    if (!webhook) {
      request.log.warn('Rejected CISPAY webhook (bad signature or payload)');
      return reply.status(401).send(fail('UNAUTHORIZED', 'Invalid signature'));
    }

    request.log.info(
      { paymentId: webhook.paymentId, status: webhook.status, sandbox: webhook.isSandbox },
      'CISPAY webhook received',
    );
    // Errors propagate → 5xx → CISPAY retries (1m, 5m, 15m, 1h).
    await deps.orders.handlePaymentWebhook(webhook.orderId, webhook);
    return ok({ received: true });
  });
}
