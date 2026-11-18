import type { PaymentMethod } from '@istock/shared';
import { getErrorMessage } from '../../lib/app-error.js';
import type { Logger } from '../../lib/logger.js';
import {
  PaymentProviderError,
  type CreatePaymentInput,
  type CreatedPayment,
  type PaymentGateway,
  type PaymentProvider,
  type PaymentState,
} from './payment-provider.js';

export interface PaymentRoute {
  /** Names the provider in logs. */
  name: string;
  provider: PaymentProvider;
  /** Methods this provider takes; a method belongs to one provider only. */
  methods: readonly PaymentMethod[];
}

/** Sends each payment to the provider of its method: SBP through one service, cards through another. */
export class PaymentRouter implements PaymentGateway {
  private readonly byMethod = new Map<PaymentMethod, PaymentRoute>();

  constructor(
    private readonly routes: readonly PaymentRoute[],
    private readonly logger: Logger,
  ) {
    for (const route of routes) {
      for (const method of route.methods) {
        if (this.byMethod.has(method)) throw new Error(`Payment method ${method} has two providers`);
        this.byMethod.set(method, route);
      }
    }
  }

  /**
   * Methods enabled at their own provider. One provider being down hides only its methods;
   * the call fails only when every provider fails, so the buyer sees an outage, not "no methods".
   */
  async listMethods(): Promise<PaymentMethod[]> {
    const results = await Promise.allSettled(
      this.routes.map(async (route) => {
        const enabled = await route.provider.listMethods();
        return enabled.filter((method) => route.methods.includes(method));
      }),
    );
    const methods: PaymentMethod[] = [];
    let failures = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        methods.push(...result.value);
        return;
      }
      failures += 1;
      this.logger.error({ provider: this.routes[index]?.name, err: getErrorMessage(result.reason) }, 'Payment methods unavailable');
    });
    if (failures > 0 && failures === results.length) {
      throw new PaymentProviderError('Every payment provider failed to list its methods');
    }
    return methods;
  }

  async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
    return this.providerFor(input.method).createPayment(input);
  }

  async getPayment(paymentId: string, method: PaymentMethod): Promise<PaymentState> {
    return this.providerFor(method).getPayment(paymentId);
  }

  private providerFor(method: PaymentMethod): PaymentProvider {
    const route = this.byMethod.get(method);
    if (!route) throw new PaymentProviderError(`No payment provider for ${method}`);
    return route.provider;
  }
}
