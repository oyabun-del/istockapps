import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUYER, OTHER_USER, createPaidOrder, createTestContext, type TestContext } from '../test/fixtures.js';
import { MOCK_CODE_TTL_SECONDS } from '../providers/delivery/mock-delivery-provider.js';
import { CODE_COOLDOWN_MS, MAX_CODE_REQUESTS } from './delivery-service.js';

let ctx: TestContext;

beforeEach(() => {
  ctx = createTestContext();
});

async function orderWithCredentials() {
  const paid = await createPaidOrder(ctx);
  await ctx.deliveryService.confirmDownload(BUYER.id, paid.id);
  await ctx.deliveryService.getCredentials(BUYER.id, paid.id);
  return paid;
}

describe('DeliveryService happy path', () => {
  it('walks the order from download to completion', async () => {
    const paid = await createPaidOrder(ctx);

    expect(await ctx.deliveryService.getDownloadUrl(BUYER.id, paid.id)).toContain('/mock-download/sberbank');

    const confirmed = await ctx.deliveryService.confirmDownload(BUYER.id, paid.id);
    expect(confirmed.status).toBe('download_confirmed');

    const credentials = await ctx.deliveryService.getCredentials(BUYER.id, paid.id);
    expect(credentials).toEqual({ login: 'demo.sberbank@example.com', password: 'Mock-Passw0rd!' });
    expect((await ctx.repos.orders.findById(paid.id))?.status).toBe('credentials_issued');

    const code = await ctx.deliveryService.requestCode(BUYER.id, paid.id);
    expect(code.code).toMatch(/^\d{6}$/);
    expect(new Date(code.nextRequestAt).getTime()).toBe(ctx.clock.current.getTime() + CODE_COOLDOWN_MS);
    expect(code.expiresAt).toBe(new Date(ctx.clock.current.getTime() + MOCK_CODE_TTL_SECONDS * 1000).toISOString());

    const completed = await ctx.deliveryService.complete(BUYER.id, paid.id);
    expect(completed.status).toBe('completed');
    expect(completed.completedAt).not.toBeNull();

    // Re-login after completion still works.
    ctx.clock.advance(CODE_COOLDOWN_MS);
    await expect(ctx.deliveryService.requestCode(BUYER.id, paid.id)).resolves.toHaveProperty('code');
  });

  it('keeps confirm, credentials and complete idempotent', async () => {
    const paid = await orderWithCredentials();

    expect((await ctx.deliveryService.confirmDownload(BUYER.id, paid.id)).status).toBe('credentials_issued');
    expect((await ctx.deliveryService.getCredentials(BUYER.id, paid.id)).login).toContain('@');
    await ctx.deliveryService.complete(BUYER.id, paid.id);
    expect((await ctx.deliveryService.complete(BUYER.id, paid.id)).status).toBe('completed');
    expect((await ctx.deliveryService.getCredentials(BUYER.id, paid.id)).login).toContain('@');
  });
});

describe('DeliveryService guards', () => {
  it('refuses everything for unpaid orders', async () => {
    const order = await ctx.orders.createOrder(BUYER, { appId: 'sberbank', paymentMethod: 'SBP' });

    await expect(ctx.deliveryService.getDownloadUrl(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(ctx.deliveryService.confirmDownload(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(ctx.deliveryService.getCredentials(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(ctx.deliveryService.requestCode(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(ctx.deliveryService.complete(BUYER.id, order.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('requires download confirmation before credentials', async () => {
    const paid = await createPaidOrder(ctx);
    await expect(ctx.deliveryService.getCredentials(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('never exposes credentials of another user', async () => {
    const paid = await orderWithCredentials();
    await expect(ctx.deliveryService.getCredentials(OTHER_USER.id, paid.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enforces the code cooldown', async () => {
    const paid = await orderWithCredentials();
    await ctx.deliveryService.requestCode(BUYER.id, paid.id);

    await expect(ctx.deliveryService.requestCode(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });

    ctx.clock.advance(CODE_COOLDOWN_MS);
    await expect(ctx.deliveryService.requestCode(BUYER.id, paid.id)).resolves.toHaveProperty('code');
  });

  it('caps the total number of codes per order', async () => {
    const paid = await orderWithCredentials();
    for (let attempt = 0; attempt < MAX_CODE_REQUESTS; attempt += 1) {
      await ctx.deliveryService.requestCode(BUYER.id, paid.id);
      ctx.clock.advance(CODE_COOLDOWN_MS);
    }
    await expect(ctx.deliveryService.requestCode(BUYER.id, paid.id)).rejects.toThrow(/Лимит/);
  });

  it('rejects a concurrent code request', async () => {
    const paid = await orderWithCredentials();
    vi.spyOn(ctx.repos.orders, 'recordCodeRequest').mockResolvedValueOnce(null);
    await expect(ctx.deliveryService.requestCode(BUYER.id, paid.id)).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('leaves expiresAt empty when the delivery API does not say how long the code lives', async () => {
    const paid = await orderWithCredentials();
    vi.spyOn(ctx.delivery, 'requestLoginCode').mockResolvedValue({ code: '123456', ttlSeconds: null });

    await expect(ctx.deliveryService.requestCode(BUYER.id, paid.id)).resolves.toEqual({
      code: '123456',
      nextRequestAt: new Date(ctx.clock.current.getTime() + CODE_COOLDOWN_MS).toISOString(),
      expiresAt: null,
    });
  });

  it('maps provider failures to DELIVERY_PROVIDER_ERROR', async () => {
    const paid = await createPaidOrder(ctx);
    vi.spyOn(ctx.delivery, 'getDownloadUrl').mockRejectedValue(new Error('api down'));
    await expect(ctx.deliveryService.getDownloadUrl(BUYER.id, paid.id)).rejects.toMatchObject({
      code: 'DELIVERY_PROVIDER_ERROR',
    });
  });
});
