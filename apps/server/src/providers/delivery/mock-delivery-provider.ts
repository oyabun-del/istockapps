import { randomInt } from 'node:crypto';
import type { Order } from '../../domain/models.js';
import type { AppCredentials, DeliveryProvider } from './delivery-provider.js';

const CODE_LENGTH = 6;

/** Development stand-in: returns fake but well-formed data. Never use in production. */
export class MockDeliveryProvider implements DeliveryProvider {
  async getDownloadUrl(order: Order): Promise<string> {
    return `https://example.com/mock-download/${encodeURIComponent(order.appId)}?order=${order.id}`;
  }

  async getCredentials(order: Order): Promise<AppCredentials> {
    return { login: `demo.${order.appId}@example.com`, password: 'Mock-Passw0rd!' };
  }

  async requestLoginCode(): Promise<string> {
    return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0');
  }
}
