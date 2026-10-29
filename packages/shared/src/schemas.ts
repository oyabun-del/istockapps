import { z } from 'zod';
import {
  ACTIVE_PAYMENT_METHOD,
  normalizePromoCode,
  type CatalogQuery,
  type CreateOrderInput,
  type PromoCheckInput,
  type StartCodeInput,
} from './api.js';
import { MAX_ORDER_ITEMS } from './pricing.js';

/** Server-side request validation. Kept out of the main entry so zod is not bundled into the Mini App. */

const APP_ID_MAX = 128;
/** Slugs, bundle ids and numeric store ids; nothing that could alter a provider URL path or query. */
const APP_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

const appIdSchema = z.string().min(1).max(APP_ID_MAX).regex(APP_ID_PATTERN).refine((id) => !id.includes('..'));

export const appIdParamSchema = z.object({ appId: appIdSchema });

const PROMO_INPUT_MAX = 64;
/** Only bounded and normalized here: a malformed code is answered with PROMO_INVALID, not a validation error. */
const promoInputSchema = z.string().max(PROMO_INPUT_MAX).transform(normalizePromoCode);

export const createOrderSchema: z.ZodType<CreateOrderInput> = z.object({
  appIds: z
    .array(appIdSchema)
    .min(1)
    .max(MAX_ORDER_ITEMS)
    .refine((ids) => new Set(ids).size === ids.length, 'Duplicate app ids'),
  paymentMethod: z.literal(ACTIVE_PAYMENT_METHOD),
  expectedTotalKopecks: z.number().int().nonnegative().optional(),
  promoCode: promoInputSchema.optional(),
});

export const promoCheckSchema: z.ZodType<PromoCheckInput> = z.object({ code: promoInputSchema });

export const catalogQuerySchema: z.ZodType<CatalogQuery> = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(64).optional(),
});

export const orderIdParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

/** Opaque ids of the delivery API (grp_…, wait_…); same safety rules as app ids. */
const deliveryIdSchema = appIdSchema;

export const startCodeSchema: z.ZodType<StartCodeInput> = z.object({ groupId: deliveryIdSchema });

export const codeWaitParamSchema = z.object({
  id: z.coerce.number().int().positive(),
  waitId: deliveryIdSchema,
});
