import type { BroadcastStatus } from './models.js';

/** The admin is still preparing the broadcast; nothing has been sent. */
export const DRAFT_STATUSES: readonly BroadcastStatus[] = ['awaiting_content', 'awaiting_buttons', 'draft'];
