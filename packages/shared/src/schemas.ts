import { z } from 'zod';
import {
  PAYMENT_METHODS,
  TICKET_MESSAGE_MAX,
  TICKET_MESSAGE_MIN,
  type CatalogQuery,
  type CreateOrderInput,
  type CreateTicketInput,
} from './api.js';

/** Server-side request validation. Kept out of the main entry so zod is not bundled into the Mini App. */

export const createOrderSchema: z.ZodType<CreateOrderInput> = z.object({
  appId: z.string().min(1).max(128),
  paymentMethod: z.enum(PAYMENT_METHODS),
});

export const createTicketSchema: z.ZodType<CreateTicketInput> = z.object({
  orderId: z.number().int().positive().nullable().optional(),
  message: z.string().trim().min(TICKET_MESSAGE_MIN).max(TICKET_MESSAGE_MAX),
});

export const catalogQuerySchema: z.ZodType<CatalogQuery> = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(64).optional(),
});

export const orderIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});
