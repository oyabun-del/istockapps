import { formatRub } from '@istock/shared';
import type { FastifyInstance } from 'fastify';
import { escapeHtml } from '../../lib/html.js';
import type { MockPaymentProvider } from '../../providers/payment/mock-payment-provider.js';
import type { OrderService } from '../../services/order-service.js';

export interface DevRoutesDeps {
  payments: MockPaymentProvider;
  orders: OrderService;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#10131a;color:#e1e2ec;font:15px/1.4 Inter,system-ui,sans-serif}
main{width:min(360px,calc(100% - 32px));padding:24px;border-radius:16px;background:#1d1f27;text-align:center}
h1{font-size:20px;margin:0 0 8px}p{color:#c3c6d7;margin:0 0 20px}
button{width:100%;height:44px;border:0;border-radius:999px;font:600 14px Inter,system-ui;cursor:pointer;margin-top:8px}
.pay{background:#2563eb;color:#fff}.cancel{background:#272a32;color:#e1e2ec}
</style></head><body><main>${body}</main></body></html>`;
}

/** Fake payment page for PAYMENT_PROVIDER=mock. Never registered in production. */
export async function devRoutes(app: FastifyInstance, deps: DevRoutesDeps): Promise<void> {
  // HTML forms post urlencoded bodies; their content is not needed.
  app.addContentTypeParser('application/x-www-form-urlencoded', (_request, _payload, done) => done(null, {}));

  app.get('/mock-pay/:paymentId', async (request, reply) => {
    const { paymentId } = request.params as { paymentId: string };
    const payment = await deps.payments.getPayment(paymentId).catch(() => null);
    reply.type('text/html; charset=utf-8');
    if (!payment) return page('Платёж не найден', '<h1>Платёж не найден</h1>');

    const action = `/dev/mock-pay/${encodeURIComponent(paymentId)}`;
    return page(
      'Тестовая оплата',
      `<h1>Тестовая оплата</h1><p>Сумма: <b>${formatRub(payment.amountKopecks)}</b><br>Статус: ${payment.status}</p>
<form method="post" action="${action}/paid"><button class="pay">Оплатить</button></form>
<form method="post" action="${action}/failed"><button class="cancel">Отклонить</button></form>`,
    );
  });

  app.post('/mock-pay/:paymentId/:result', async (request, reply) => {
    const { paymentId, result } = request.params as { paymentId: string; result: string };
    const status = result === 'paid' ? 'PAID' : 'FAILED';
    const payment = deps.payments.setStatus(paymentId, status);
    reply.type('text/html; charset=utf-8');
    if (!payment) return page('Платёж не найден', '<h1>Платёж не найден</h1>');

    await deps.orders.handlePaymentWebhook(payment.orderId, { ...payment, isSandbox: true });
    const title = status === 'PAID' ? 'Оплачено' : 'Оплата отклонена';
    return page(title, `<h1>${title}</h1><p>Вернитесь в Telegram. Статус заказа обновится автоматически.</p>`);
  });
}
