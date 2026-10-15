import type { Order } from '../../domain/models.js';

export interface AppCredentials {
  login: string;
  password: string;
}

/**
 * Port for the external delivery API: download link, Apple ID credentials and login code.
 * Replace MockDeliveryProvider with an HTTP implementation once the API is available.
 */
export interface DeliveryProvider {
  getDownloadUrl(order: Order): Promise<string>;
  getCredentials(order: Order): Promise<AppCredentials>;
  requestLoginCode(order: Order): Promise<string>;
}
