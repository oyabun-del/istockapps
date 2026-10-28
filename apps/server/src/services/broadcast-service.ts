import { parseBroadcastButtons } from '../domain/broadcast-buttons.js';
import { DRAFT_STATUSES } from '../domain/broadcast-status.js';
import type { Broadcast, BroadcastButton, BroadcastPatch, BroadcastStatus, Keyboard, MessageRef } from '../domain/models.js';
import { AppError, getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';
import type { BroadcastRepository, UserRepository } from '../repositories/repositories.js';
import type { BroadcastTelegram, CopyOutcome } from './broadcast-port.js';
import type { BroadcastRunner } from './broadcast-runner.js';
import { BROADCAST_KEYBOARD, BROADCAST_TEXT, type BroadcastAction } from './broadcast-ui.js';

/** A message the admin sent to the bot. */
export interface IncomingMessage extends MessageRef {
  /** Text or caption; buttons are read from it. */
  text?: string;
  /** Set for every part of an album. */
  mediaGroupId: string | null;
}

export interface BroadcastServiceDeps {
  broadcasts: BroadcastRepository;
  users: Pick<UserRepository, 'countRecipients'>;
  telegram: BroadcastTelegram;
  runner: Pick<BroadcastRunner, 'wake' | 'cancel'>;
  webAppUrl: string;
  logger: Logger;
  now?: () => Date;
}

/** The admin's side of a broadcast: compose in the bot chat, preview, confirm, stop. */
export class BroadcastService {
  private readonly now: () => Date;
  /** Last album answered per admin, so a 10-photo album gets one reply, not ten. */
  private readonly refusedAlbums = new Map<number, string>();

  constructor(private readonly deps: BroadcastServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Starts a new broadcast; an unfinished draft of this admin is dropped. */
  async begin(adminId: number): Promise<void> {
    const previous = await this.deps.broadcasts.findOpenDraft(adminId);
    if (previous) await this.moveTo(previous, DRAFT_STATUSES, 'cancelled', { finishedAt: this.now() });
    const broadcast = await this.deps.broadcasts.create(adminId);
    await this.deps.telegram.sendText(adminId, BROADCAST_TEXT.askContent, BROADCAST_KEYBOARD.awaitingContent(broadcast.id));
  }

  /** Returns false when the message is not part of a broadcast, so other handlers may take it. */
  async handleMessage(adminId: number, message: IncomingMessage): Promise<boolean> {
    const draft = await this.deps.broadcasts.findOpenDraft(adminId);
    if (draft?.status === 'awaiting_content') {
      await this.acceptContent(draft, message);
      return true;
    }
    if (draft?.status === 'awaiting_buttons') {
      await this.acceptButtons(draft, message);
      return true;
    }
    return false;
  }

  /** A press on one of the admin's control buttons; throws AppError for a stale button. */
  async handleAction(adminId: number, id: number, action: BroadcastAction, messageId: number): Promise<void> {
    const broadcast = await this.deps.broadcasts.findById(id);
    if (!broadcast || broadcast.authorId !== adminId) throw stale();
    const panel = { chatId: adminId, messageId };
    switch (action) {
      case 'edit':
        await this.moveTo(broadcast, ['draft'], 'awaiting_content');
        return this.edit(panel, BROADCAST_TEXT.askContent, BROADCAST_KEYBOARD.awaitingContent(id));
      case 'buttons':
        await this.moveTo(broadcast, ['draft'], 'awaiting_buttons');
        return this.edit(panel, BROADCAST_TEXT.askButtons, BROADCAST_KEYBOARD.awaitingButtons(id));
      case 'clear':
        return this.clearButtons(broadcast);
      case 'send':
        return this.askToConfirm(broadcast, panel);
      case 'confirm':
        return this.startSending(broadcast, panel);
      case 'back': {
        const draft = await this.moveTo(broadcast, ['draft', 'awaiting_buttons'], 'draft');
        return this.edit(panel, BROADCAST_TEXT.panel(draft), BROADCAST_KEYBOARD.panel(draft));
      }
      case 'cancel':
        await this.moveTo(broadcast, DRAFT_STATUSES, 'cancelled', { finishedAt: this.now() });
        return this.edit(panel, BROADCAST_TEXT.cancelled);
      case 'stop':
        // The worker stops after the current copy and turns the progress message into the report.
        await this.moveTo(broadcast, ['sending'], 'cancelled', { finishedAt: this.now() });
        this.deps.runner.cancel(id);
        return;
    }
  }

  private async acceptContent(draft: Broadcast, message: IncomingMessage): Promise<void> {
    const adminId = draft.authorId;
    if (message.mediaGroupId) {
      if (this.refusedAlbums.get(adminId) === message.mediaGroupId) return;
      this.refusedAlbums.set(adminId, message.mediaGroupId);
      await this.deps.telegram.sendText(adminId, BROADCAST_TEXT.albumNotSupported);
      return;
    }
    const source = { chatId: message.chatId, messageId: message.messageId };
    const outcome = await this.preview(adminId, source, draft.buttons);
    if (outcome.kind !== 'sent') {
      await this.deps.telegram.sendText(adminId, BROADCAST_TEXT.copyFailed(failureReason(outcome)));
      return;
    }
    await this.showPanel(await this.moveTo(draft, ['awaiting_content'], 'draft', { source }));
  }

  private async acceptButtons(draft: Broadcast, message: IncomingMessage): Promise<void> {
    const adminId = draft.authorId;
    const keyboard = BROADCAST_KEYBOARD.awaitingButtons(draft.id);
    if (!message.text) {
      await this.deps.telegram.sendText(adminId, BROADCAST_TEXT.buttonsNeedText, keyboard);
      return;
    }
    const parsed = parseBroadcastButtons(message.text, this.deps.webAppUrl);
    if (!parsed.ok) {
      await this.deps.telegram.sendText(adminId, BROADCAST_TEXT.buttonsInvalid(parsed.error), keyboard);
      return;
    }
    // Telegram has the last word on links (e.g. web_app needs https), so preview before saving.
    const outcome = draft.source ? await this.preview(adminId, draft.source, parsed.value) : null;
    if (outcome && outcome.kind !== 'sent') {
      await this.deps.telegram.sendText(adminId, BROADCAST_TEXT.buttonsRejected(failureReason(outcome)), keyboard);
      return;
    }
    await this.showPanel(await this.moveTo(draft, ['awaiting_buttons'], 'draft', { buttons: parsed.value }));
  }

  private async clearButtons(broadcast: Broadcast): Promise<void> {
    if (broadcast.status !== 'draft' || !broadcast.source) throw stale();
    const updated = await this.deps.broadcasts.update(broadcast.id, { buttons: [] });
    await this.preview(updated.authorId, broadcast.source, []);
    await this.showPanel(updated);
  }

  private async askToConfirm(broadcast: Broadcast, panel: MessageRef): Promise<void> {
    if (broadcast.status !== 'draft') throw stale();
    const recipients = await this.recipientsOrThrow();
    await this.edit(panel, BROADCAST_TEXT.confirm(recipients), BROADCAST_KEYBOARD.confirm(broadcast.id));
  }

  private async startSending(broadcast: Broadcast, panel: MessageRef): Promise<void> {
    const total = await this.recipientsOrThrow();
    const sending = await this.moveTo(broadcast, ['draft'], 'sending', {
      total,
      progressMessageId: panel.messageId,
      cursorUserId: null,
      sent: 0,
      blocked: 0,
      failed: 0,
      startedAt: this.now(),
    });
    this.deps.logger.info({ broadcastId: sending.id, adminId: sending.authorId, total }, 'Broadcast started');
    // Wake first: the broadcast is committed, a failed edit of the admin's message must not leave it unsent.
    this.deps.runner.wake();
    try {
      await this.edit(panel, BROADCAST_TEXT.progress(sending), BROADCAST_KEYBOARD.progress(sending.id));
    } catch (error: unknown) {
      this.deps.logger.warn({ broadcastId: sending.id, err: getErrorMessage(error) }, 'Failed to show broadcast progress');
    }
  }

  private async recipientsOrThrow(): Promise<number> {
    const recipients = await this.deps.users.countRecipients();
    if (recipients === 0) throw new AppError('INVALID_STATE', BROADCAST_TEXT.noRecipients);
    return recipients;
  }

  /** Copies the message to the admin with the very keyboard users will get. */
  private preview(adminId: number, source: MessageRef, buttons: Keyboard<BroadcastButton>): Promise<CopyOutcome> {
    return this.deps.telegram.copy(adminId, source, buttons);
  }

  private showPanel(broadcast: Broadcast): Promise<void> {
    return this.deps.telegram.sendText(broadcast.authorId, BROADCAST_TEXT.panel(broadcast), BROADCAST_KEYBOARD.panel(broadcast));
  }

  private edit(panel: MessageRef, html: string, keyboard?: Keyboard): Promise<void> {
    return this.deps.telegram.editText(panel.chatId, panel.messageId, html, keyboard);
  }

  /** Compare-and-set; a concurrent change (double tap, another action) makes the button stale. */
  private async moveTo(
    broadcast: Broadcast,
    from: readonly BroadcastStatus[],
    status: BroadcastStatus,
    patch: Omit<BroadcastPatch, 'status'> = {},
  ): Promise<Broadcast> {
    const updated = await this.deps.broadcasts.transition(broadcast.id, from, { ...patch, status });
    if (!updated) throw stale();
    return updated;
  }
}

function stale(): AppError {
  return new AppError('INVALID_STATE', BROADCAST_TEXT.stale);
}

function failureReason(outcome: CopyOutcome): string {
  if ('reason' in outcome) return outcome.reason;
  if (outcome.kind === 'retry') return 'Too Many Requests';
  return outcome.kind;
}
