import { z } from 'zod';

/**
 * Shared Zod schemas for server-side request-body validation (audit 3.2).
 *
 * Rules:
 * - Every body-accepting route validates before touching the DB.
 * - Errors surface as a generic 400 ("Invalid request body") — internal
 *   schema details are never echoed to the client (audit 3.2).
 * - String length caps prevent oversized payloads / abusive inputs.
 */

const MAX_NAME = 100;
const MAX_DESCRIPTION = 2000;
const MAX_PASSWORD = 128;
const MIN_PASSWORD = 8; // must match the client's minLength (page.tsx)
const MAX_FILENAME = 255;
const MAX_CONTENT = 2 * 1024 * 1024; // 2MB chars — matches upload size cap
const MAX_RELATIONSHIP = 200;
const MAX_EMAIL = 254;

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Invalid email address')
  .max(MAX_EMAIL);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authSignupSchema = z.object({
  action: z.literal('signup'),
  email: emailSchema,
  password: z.string().min(MIN_PASSWORD, `Password must be at least ${MIN_PASSWORD} characters`).max(MAX_PASSWORD),
  name: z.string().trim().max(MAX_NAME).optional(),
  remember: z.boolean().optional(),
});

export const authLoginSchema = z.object({
  action: z.literal('login'),
  email: emailSchema,
  password: z.string().min(1).max(MAX_PASSWORD),
  remember: z.boolean().optional(),
});

export const authLogoutAllSchema = z.object({
  action: z.literal('logout_all'),
});

export const authBodySchema = z.discriminatedUnion('action', [
  authSignupSchema,
  authLoginSchema,
  authLogoutAllSchema,
]);

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export const createSubjectSchema = z.object({
  name: z.string().trim().min(1, 'Subject name is required').max(MAX_NAME),
  description: z.string().trim().max(MAX_DESCRIPTION).optional().nullable(),
});

export const updateSubjectSchema = z.object({
  name: z.string().trim().min(1).max(MAX_NAME).optional(),
  description: z.string().trim().max(MAX_DESCRIPTION).optional().nullable(),
  archived: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const updateSettingsSchema = z
  .object({
    card_density: z.number().int().min(10).max(40).optional(),
    graph_verbosity: z.enum(['concise', 'standard', 'detailed']).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Notes upload (JSON path) & watcher sync
// ---------------------------------------------------------------------------

export const uploadNoteSchema = z.object({
  subject_id: z.string().min(1).max(100),
  filename: z.string().trim().max(MAX_FILENAME).optional(),
  content: z.string().min(1).max(MAX_CONTENT),
});

export const syncFileSchema = z.object({
  path: z.string().max(1024).optional(),
  filename: z.string().trim().max(MAX_FILENAME).optional(),
  content: z.string().min(1).max(MAX_CONTENT),
  hash: z.string().max(128).optional(),
  subject_id: z.string().min(1).max(100).optional(),
});

export const syncDeleteSchema = z.object({
  filename: z.string().trim().min(1).max(MAX_FILENAME),
  subject_id: z.string().min(1).max(100).optional(),
  path: z.string().max(1024).optional(),
});

// ---------------------------------------------------------------------------
// Note content search (query params)
// ---------------------------------------------------------------------------

export const noteSearchQuerySchema = z.object({
  q: z.string().trim().min(1, 'Search query is required').max(200),
  subject_id: z.string().min(1).max(100).optional(),
});

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

export const generateCodeSchema = z.object({ action: z.literal('generate_code') });

export const redeemCodeSchema = z.object({
  action: z.literal('redeem_code'),
  pairing_code: z.string().trim().min(1).max(20),
  device_name: z.string().trim().max(MAX_NAME).optional(),
  folder_path: z.string().max(1024).optional(),
  subject_id: z.string().min(1).max(100).optional(),
});

export const revokeDeviceSchema = z.object({
  action: z.literal('revoke'),
  device_id: z.string().min(1).max(100),
});

export const deviceActionSchema = z.discriminatedUnion('action', [
  generateCodeSchema,
  redeemCodeSchema,
  revokeDeviceSchema,
]);

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export const cardEditSchema = z.object({
  action: z.literal('edit'),
  card_id: z.string().min(1).max(100),
  front: z.string().min(1).max(5000),
  back: z.string().min(1).max(5000),
});

export const cardAcceptSchema = z.object({
  action: z.literal('accept'),
  card_id: z.string().min(1).max(100).optional(),
});

export const cardDeleteSchema = z.object({
  action: z.literal('delete'),
  card_id: z.string().min(1).max(100),
});

export const cardReviewSchema = z.object({
  action: z.literal('review'),
  card_id: z.string().min(1).max(100),
  rating: z.enum(['again', 'hard', 'good', 'easy']),
});

export const cardActionSchema = z.discriminatedUnion('action', [
  cardEditSchema,
  cardAcceptSchema,
  cardDeleteSchema,
  cardReviewSchema,
]);

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

export const graphRenameSchema = z.object({
  action: z.literal('rename'),
  node_id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(MAX_NAME),
  definition: z.string().trim().max(MAX_DESCRIPTION).optional(),
});

export const graphDeleteSchema = z.object({
  action: z.literal('delete'),
  node_id: z.string().min(1).max(100),
});

export const graphMergeSchema = z.object({
  action: z.literal('merge'),
  node_id: z.string().min(1).max(100),
  merge_into_id: z.string().min(1).max(100),
});

export const graphAddEdgeSchema = z.object({
  action: z.literal('add_edge'),
  from_node_id: z.string().min(1).max(100),
  to_node_id: z.string().min(1).max(100),
  relationship_type: z.string().trim().max(MAX_RELATIONSHIP).optional(),
});

export const graphActionSchema = z.discriminatedUnion('action', [
  graphRenameSchema,
  graphDeleteSchema,
  graphMergeSchema,
  graphAddEdgeSchema,
]);

// ---------------------------------------------------------------------------
// Generic parse helper — returns { data } or a generic 400 message
// ---------------------------------------------------------------------------

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): { ok: true; data: T } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) {
    return { ok: false, error: 'Invalid request body' };
  }
  return { ok: true, data: result.data };
}
