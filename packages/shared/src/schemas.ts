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

const APP_ID_MAX = 128;
/** Slugs, bundle ids and numeric store ids; nothing that could alter a provider URL path or query. */
const APP_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const appIdSchema = z.string().min(1).max(APP_ID_MAX).regex(APP_ID_PATTERN).refine((id) => !id.includes('..'));

export const appIdParamSchema = z.object({ appId: appIdSchema });

export const createOrderSchema: z.ZodType<CreateOrderInput> = z.object({
  appId: appIdSchema,
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
