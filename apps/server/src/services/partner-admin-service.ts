import type { InstalliosClient } from '../providers/installios/installios-client.js';

const RUB = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB' });

export interface CatalogSync {
  sync(): Promise<boolean>;
  readonly size: number;
}

export interface PartnerAdminDeps {
  client: Pick<InstalliosClient, 'getBalance'>;
  catalog: CatalogSync;
}

/** Install-IOS operations for shop admins, answered as Telegram HTML. */
export class PartnerAdminService {
  constructor(private readonly deps: PartnerAdminDeps) {}

  async balanceText(): Promise<string> {
    const balance = await this.deps.client.getBalance();
    return [
      '<b>Install-IOS: баланс</b>',
      `Задолженность: ${RUB.format(balance.debt_rubles)}`,
      `Аванс: ${RUB.format(balance.advance_rubles)}`,
      `Итог: ${RUB.format(balance.net_rubles)} (плюс — долг, минус — аванс)`,
    ].join('\n');
  }

  async syncText(): Promise<string> {
    const isSynced = await this.deps.catalog.sync();
    return isSynced
      ? `Каталог обновлён: ${this.deps.catalog.size} приложений.`
      : `Не удалось обновить каталог, в магазине остался прежний список (${this.deps.catalog.size} приложений).`;
  }
}
