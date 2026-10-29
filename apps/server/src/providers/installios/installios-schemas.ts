import { CODE_WAIT_STATUSES } from '@istock/shared';
import { z } from 'zod';

/**
 * Response shapes of the Install-IOS Partner API (contract 1.11.0, https://api.installios.ru/openapi.json).
 * Only the fields this project uses are declared; unknown fields are dropped on parse.
 */

export const catalogSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  applications_count: z.number().int().nonnegative(),
});

export const catalogsResponseSchema = z.object({ catalogs: z.array(catalogSchema) });

export const applicationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  icon_url: z.string().nullish(),
});

export const applicationsResponseSchema = z.object({ applications: z.array(applicationSchema) });

const linksSchema = z.object({ main: z.string(), reserve: z.string() });

const orderApplicationSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  /** null for revoked access or an app whose reissue is temporarily unavailable. */
  links: linksSchema.nullable(),
});

const orderGroupSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  /** Individual deadline after a partial reissue; otherwise the order's expires_at applies. */
  expires_at: z.number().int().optional(),
  access_revoked: z.boolean().optional(),
  access_revocation_reason: z.string().optional(),
  access_message: z.string().optional(),
  successful_codes: z.number().int().nonnegative(),
  successful_codes_limit: z.number().int().nonnegative(),
  applications: z.array(orderApplicationSchema),
});

/**
 * Statuses the API may extend later: an unknown value becomes 'unknown' instead of failing the whole
 * response, so buyers keep their links and credentials.
 */
const automaticReplacementSchema = z.object({
  status: z.enum(['pending', 'partial', 'replaced', 'unknown']).catch('unknown'),
  applications: z
    .array(
      z.object({
        application_id: z.string(),
        status: z.enum(['pending', 'replaced', 'unknown']).catch('unknown'),
        expires_at: z.number().int().optional(),
      }),
    )
    .default([]),
});

export const orderSchema = z.object({
  id: z.string().min(1),
  external_order_id: z.string(),
  status: z.enum(['active', 'completed', 'expired', 'unknown']).catch('unknown'),
  sandbox: z.boolean(),
  expires_at: z.number().int(),
  fallback_url: z.string(),
  qr_url: z.string(),
  groups: z.array(orderGroupSchema),
  automatic_replacement: automaticReplacementSchema.nullish(),
});

export const credentialsResponseSchema = z.object({
  order_id: z.string(),
  groups: z.array(
    z.object({
      id: z.string().min(1),
      /** Empty strings when access_revoked is true. */
      login: z.string(),
      password: z.string(),
      access_revoked: z.boolean().optional(),
    }),
  ),
});

export const codeWaitSchema = z.object({
  id: z.string().min(1),
  /** An unknown state ends the wait: the buyer can start a new one instead of polling forever. */
  status: z.enum(CODE_WAIT_STATUSES).catch('timed_out'),
  code: z.string().nullish(),
  valid_for_seconds: z.number().int().nonnegative().nullish(),
  deadline_at: z.number().int().nullish(),
  order_expires_at: z.number().int().nullish(),
  access_revoked: z.boolean().optional(),
});

export const balanceSchema = z.object({
  net_rubles: z.number(),
  debt_rubles: z.number(),
  advance_rubles: z.number(),
  currency: z.string(),
});

export const healthSchema = z.object({ status: z.string() });

export const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

export type InstalliosCatalog = z.infer<typeof catalogSchema>;
export type InstalliosApplication = z.infer<typeof applicationSchema>;
export type InstalliosOrder = z.infer<typeof orderSchema>;
export type InstalliosOrderGroup = z.infer<typeof orderGroupSchema>;
export type InstalliosCredentials = z.infer<typeof credentialsResponseSchema>;
export type InstalliosCodeWait = z.infer<typeof codeWaitSchema>;
export type InstalliosBalance = z.infer<typeof balanceSchema>;
