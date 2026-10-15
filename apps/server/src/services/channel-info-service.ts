import { getErrorMessage } from '../lib/app-error.js';
import type { Logger } from '../lib/logger.js';

export interface ChannelSnapshot {
  title: string;
  memberCount: number;
}

export type ChannelFetcher = (chatId: string) => Promise<ChannelSnapshot>;

export interface ChannelInfo {
  title: string | null;
  subscriberCount: number | null;
}

/** Title and subscriber count change rarely; the subscription gate reads them on every app start. */
export const CHANNEL_INFO_TTL_MS = 10 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 1000;

const UNKNOWN: ChannelInfo = { title: null, subscriberCount: null };

export interface ChannelInfoServiceDeps {
  channel: string;
  fetchChannel: ChannelFetcher;
  logger: Logger;
  now?: () => number;
}

/** Public facts about the required channel, shown on the subscription gate. Never throws. */
export class ChannelInfoService {
  private cached: { info: ChannelInfo; expiresAt: number } | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: ChannelInfoServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  async getInfo(): Promise<ChannelInfo> {
    if (this.cached && this.cached.expiresAt > this.now()) return this.cached.info;

    try {
      const snapshot = await this.deps.fetchChannel(this.deps.channel);
      const info = { title: snapshot.title, subscriberCount: snapshot.memberCount };
      this.cached = { info, expiresAt: this.now() + CHANNEL_INFO_TTL_MS };
      return info;
    } catch (error: unknown) {
      // Usually the bot is not an admin of the channel; the gate still works without these details.
      this.deps.logger.warn({ err: getErrorMessage(error) }, 'Channel info unavailable');
      const info = this.cached?.info ?? UNKNOWN;
      // Back off so a broken channel setup does not cost a Bot API call on every /me.
      this.cached = { info, expiresAt: this.now() + FAILURE_RETRY_MS };
      return info;
    }
  }
}
