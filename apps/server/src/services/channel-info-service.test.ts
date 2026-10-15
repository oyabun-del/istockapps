import { describe, expect, it, vi } from 'vitest';
import { silentLogger } from '../lib/logger.js';
import { CHANNEL_INFO_TTL_MS, ChannelInfoService, type ChannelFetcher } from './channel-info-service.js';

function createService(fetchChannel: ChannelFetcher, now = () => 0) {
  return new ChannelInfoService({ channel: '@test_channel', fetchChannel, logger: silentLogger, now });
}

describe('ChannelInfoService', () => {
  it('returns the channel title and subscriber count and caches them', async () => {
    let now = 0;
    const fetchChannel = vi.fn<ChannelFetcher>().mockResolvedValue({ title: 'AppDrop', memberCount: 42_800 });
    const service = createService(fetchChannel, () => now);

    expect(await service.getInfo()).toEqual({ title: 'AppDrop', subscriberCount: 42_800 });
    await service.getInfo();
    expect(fetchChannel).toHaveBeenCalledTimes(1);
    expect(fetchChannel).toHaveBeenCalledWith('@test_channel');

    now += CHANNEL_INFO_TTL_MS + 1;
    await service.getInfo();
    expect(fetchChannel).toHaveBeenCalledTimes(2);
  });

  it('degrades to unknown values when the Bot API fails, so the gate still renders', async () => {
    const service = createService(vi.fn<ChannelFetcher>().mockRejectedValue(new Error('403: bot is not a member')));

    expect(await service.getInfo()).toEqual({ title: null, subscriberCount: null });
  });

  it('keeps the last known value when a refresh fails', async () => {
    let now = 0;
    const fetchChannel = vi
      .fn<ChannelFetcher>()
      .mockResolvedValueOnce({ title: 'AppDrop', memberCount: 10 })
      .mockRejectedValueOnce(new Error('timeout'));
    const service = createService(fetchChannel, () => now);

    await service.getInfo();
    now += CHANNEL_INFO_TTL_MS + 1;

    expect(await service.getInfo()).toEqual({ title: 'AppDrop', subscriberCount: 10 });
  });
});
