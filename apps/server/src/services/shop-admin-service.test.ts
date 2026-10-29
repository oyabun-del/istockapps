import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUYER, createTestContext, type TestContext } from '../test/fixtures.js';
import { CheckoutGate } from './checkout-gate.js';
import { ShopAdminService } from './shop-admin-service.js';

const ADMIN = { id: 111, name: 'Анна <Admin>' };

let ctx: TestContext;
let notifyAdmins: ReturnType<typeof vi.fn>;
let service: ShopAdminService;

beforeEach(() => {
  ctx = createTestContext();
  notifyAdmins = vi.fn().mockResolvedValue(undefined);
  service = new ShopAdminService({ checkout: ctx.checkout, repos: ctx.repos, notifyAdmins, now: ctx.clock.now });
});

describe('payments mode', () => {
  it('shows the mode with a button per mode, the current one checked', async () => {
    const view = await service.paymentsView();

    expect(view.html).toContain('Сейчас: <b>🟢 открыт для всех</b>');
    expect(view.keyboard?.map((row) => row[0]?.text)).toEqual([
      '✅ 🟢 Открыть для всех',
      '🟡 Только по промокоду',
      '🔴 Закрыть',
    ]);
    expect(view.keyboard?.[1]?.[0]).toMatchObject({ kind: 'callback', data: 'payments:promo' });
  });

  it('switches the mode and tells the other admins who did it', async () => {
    const view = await service.setPaymentsMode('promo', ADMIN);

    expect(await ctx.checkout.getMode()).toBe('promo');
    expect(view.html).toContain('Сейчас: <b>🟡 только по промокоду</b>');
    expect(notifyAdmins).toHaveBeenCalledWith(
      '💳 Анна &lt;Admin&gt; (id <code>111</code>) переключил приём оплат: <b>🟡 только по промокоду</b>',
      ADMIN.id,
    );
  });

  it('offers no "open to everyone" while payments are fake', async () => {
    const checkout = new CheckoutGate({ repos: ctx.repos, isOpenModeAllowed: false });
    const fake = new ShopAdminService({ checkout, repos: ctx.repos, notifyAdmins });

    const view = await fake.paymentsView();
    const afterOldButton = await fake.setPaymentsMode('open', ADMIN);

    expect(view.html).toContain('Сейчас: <b>🟡 только по промокоду</b>');
    expect(view.html).toContain('приложения выдаются только по промокоду');
    expect(view.keyboard).toEqual([
      [expect.objectContaining({ data: 'payments:promo' })],
      [expect.objectContaining({ data: 'payments:closed' })],
    ]);
    expect(afterOldButton.html).toContain('🟡 только по промокоду');
    expect(notifyAdmins).not.toHaveBeenCalled();
  });

  it('does not notify anyone when the mode stays the same', async () => {
    await service.setPaymentsMode('open', ADMIN);

    expect(notifyAdmins).not.toHaveBeenCalled();
  });
});

describe('/promo', () => {
  it('lists no codes yet, with the commands', async () => {
    const text = await service.promoCommand('', ADMIN);

    expect(text).toContain('Промокодов пока нет.');
    expect(text).toContain('/promo add [КОД] [N]');
  });

  it('creates a named code for five apps by default and hints at the payments mode', async () => {
    const text = await service.promoCommand('add ios-review', ADMIN);

    expect(text).toContain('✅ Промокод <code>IOS-REVIEW</code> на 5 приложений создан.');
    expect(text).toContain('/payments');
    expect(await ctx.repos.promoCodes.findByCode('IOS-REVIEW')).toMatchObject({ maxApps: 5, createdBy: ADMIN.id });
  });

  it('creates a random code when only the number of apps is given', async () => {
    await ctx.checkout.setMode('promo');

    const text = await service.promoCommand('add 3', ADMIN);

    expect(text).toMatch(/^✅ Промокод <code>[A-HJ-NP-Z2-9]{8}<\/code> на 3 приложения создан\.$/);
  });

  it('refuses malformed codes, bad numbers and duplicates', async () => {
    await service.promoCommand('add TAKEN-1', ADMIN);

    expect(await service.promoCommand('add no', ADMIN)).toContain('от 6 до 32');
    expect(await service.promoCommand('add GOOD 0', ADMIN)).toContain('от 1 до 100');
    expect(await service.promoCommand('add GOOD 101', ADMIN)).toContain('от 1 до 100');
    expect(await service.promoCommand('add GOOD x', ADMIN)).toContain('от 1 до 100');
    expect(await service.promoCommand('add taken-1', ADMIN)).toContain('уже есть');
  });

  it('lists codes with how many apps they have used', async () => {
    await service.promoCommand('add IOS-REVIEW', ADMIN);
    await service.promoCommand('add OLD-CODE 2', ADMIN);
    await service.promoCommand('off old-code', ADMIN);
    await ctx.checkout.setMode('promo');
    await ctx.orders.createOrder(BUYER, { appIds: ['sberbank', 'tbank'], paymentMethod: 'SBP', promoCode: 'IOS-REVIEW' });

    const text = await service.promoCommand('list', ADMIN);

    expect(text).toContain('<code>OLD-CODE</code> — 0/2, выключен\n<code>IOS-REVIEW</code> — 2/5');
  });

  it('turns a code off and says when there is no such code', async () => {
    await service.promoCommand('add IOS-REVIEW', ADMIN);

    expect(await service.promoCommand('off ios-review', ADMIN)).toContain('<code>IOS-REVIEW</code> выключен');
    expect((await ctx.repos.promoCodes.findByCode('IOS-REVIEW'))?.disabledAt).not.toBeNull();
    expect(await service.promoCommand('off <b>', ADMIN)).toBe('Промокода <code>&lt;B&gt;</code> нет.');
    expect(await service.promoCommand('off', ADMIN)).toContain('Укажите код');
  });

  it('explains the commands when the action is unknown', async () => {
    expect(await service.promoCommand('delete X', ADMIN)).toContain('Не понял команду');
  });
});
