import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../lib/app-error.js';
import { silentLogger } from '../lib/logger.js';
import { createMemoryRepositories, type MemoryRepositories } from '../repositories/memory/memory-repositories.js';
import { FakeBroadcastTelegram } from '../test/fake-broadcast-telegram.js';
import { BroadcastService, type IncomingMessage } from './broadcast-service.js';

const ADMIN = 7;
const OTHER_ADMIN = 8;
const WEBAPP = 'https://shop.example.com';
const PANEL_MESSAGE = 500;

let repos: MemoryRepositories;
let telegram: FakeBroadcastTelegram;
let wake: ReturnType<typeof vi.fn>;
let cancel: ReturnType<typeof vi.fn>;
let service: BroadcastService;

beforeEach(async () => {
  repos = createMemoryRepositories();
  telegram = new FakeBroadcastTelegram();
  wake = vi.fn();
  cancel = vi.fn();
  service = new BroadcastService({
    broadcasts: repos.broadcasts,
    users: repos.users,
    telegram,
    runner: { wake, cancel },
    webAppUrl: WEBAPP,
    logger: silentLogger,
  });
  for (const id of [1, 2, 3]) {
    await repos.users.upsert({ id, firstName: `U${id}`, lastName: null, username: null, photoUrl: null });
  }
});

function message(messageId: number, patch: Partial<IncomingMessage> = {}): IncomingMessage {
  return { chatId: ADMIN, messageId, text: 'Привет', mediaGroupId: null, ...patch };
}

async function draftWithContent(): Promise<number> {
  await service.begin(ADMIN);
  await service.handleMessage(ADMIN, message(100));
  const draft = await repos.broadcasts.findOpenDraft(ADMIN);
  if (!draft) throw new Error('no draft');
  return draft.id;
}

function expectStale(promise: Promise<unknown>) {
  return expect(promise).rejects.toSatisfy((error) => error instanceof AppError && error.code === 'INVALID_STATE');
}

describe('BroadcastService draft', () => {
  it('asks for the message and replaces an unfinished draft', async () => {
    await service.begin(ADMIN);
    const first = await repos.broadcasts.findOpenDraft(ADMIN);
    await service.begin(ADMIN);

    expect(telegram.texts[0]?.html).toContain('Новая рассылка');
    expect(FakeBroadcastTelegram.actions(telegram.texts[0]?.keyboard)).toEqual([`bc:cancel:${first?.id}`]);
    expect((await repos.broadcasts.findById(first?.id ?? 0))?.status).toBe('cancelled');
    expect((await repos.broadcasts.findOpenDraft(ADMIN))?.id).not.toBe(first?.id);
  });

  it('ignores messages when the admin has no draft', async () => {
    expect(await service.handleMessage(ADMIN, message(100))).toBe(false);
    expect(telegram.copies).toHaveLength(0);
  });

  it('shows the message exactly as users will get it and saves it', async () => {
    const id = await draftWithContent();

    expect(telegram.copies[0]).toEqual({ chatId: ADMIN, source: { chatId: ADMIN, messageId: 100 }, keyboard: [] });
    expect(await repos.broadcasts.findById(id)).toMatchObject({
      status: 'draft',
      source: { chatId: ADMIN, messageId: 100 },
    });
    expect(FakeBroadcastTelegram.actions(telegram.texts.at(-1)?.keyboard)).toEqual([
      `bc:edit:${id}`,
      `bc:buttons:${id}`,
      `bc:send:${id}`,
      `bc:cancel:${id}`,
    ]);
  });

  it('leaves other messages alone once the draft has content', async () => {
    await draftWithContent();
    expect(await service.handleMessage(ADMIN, message(101))).toBe(false);
  });

  it('refuses albums once per album', async () => {
    await service.begin(ADMIN);

    await service.handleMessage(ADMIN, message(100, { mediaGroupId: 'g1' }));
    await service.handleMessage(ADMIN, message(101, { mediaGroupId: 'g1' }));

    expect(telegram.texts.filter((text) => text.html.includes('Альбомы'))).toHaveLength(1);
    expect((await repos.broadcasts.findOpenDraft(ADMIN))?.status).toBe('awaiting_content');
  });

  it('explains when Telegram cannot copy the message', async () => {
    await service.begin(ADMIN);
    telegram.outcomes.set(ADMIN, [{ kind: 'failed', reason: "Bad Request: the message can't be copied" }]);

    await service.handleMessage(ADMIN, message(100));

    expect(telegram.texts.at(-1)?.html).toContain("the message can't be copied");
    expect(await repos.broadcasts.findOpenDraft(ADMIN)).toMatchObject({ status: 'awaiting_content', source: null });
  });

  it('replaces the message and keeps the buttons', async () => {
    const id = await draftWithContent();
    await service.handleAction(ADMIN, id, 'buttons', PANEL_MESSAGE);
    await service.handleMessage(ADMIN, message(102, { text: 'Канал - https://t.me/channel' }));

    await service.handleAction(ADMIN, id, 'edit', PANEL_MESSAGE);
    await service.handleMessage(ADMIN, message(103));

    expect(await repos.broadcasts.findById(id)).toMatchObject({
      status: 'draft',
      source: { chatId: ADMIN, messageId: 103 },
      buttons: [[{ kind: 'url', text: 'Канал', url: 'https://t.me/channel' }]],
    });
  });
});

describe('BroadcastService buttons', () => {
  it('attaches parsed buttons and previews them', async () => {
    const id = await draftWithContent();

    await service.handleAction(ADMIN, id, 'buttons', PANEL_MESSAGE);
    expect(telegram.edits.at(-1)).toMatchObject({ messageId: PANEL_MESSAGE });
    expect(telegram.edits.at(-1)?.html).toContain('Кнопки');

    expect(await service.handleMessage(ADMIN, message(101, { text: 'Магазин - shop' }))).toBe(true);

    const keyboard = [[{ kind: 'web_app', text: 'Магазин', url: WEBAPP }]];
    expect(telegram.copies.at(-1)).toMatchObject({ source: { messageId: 100 }, keyboard });
    expect(await repos.broadcasts.findById(id)).toMatchObject({ status: 'draft', buttons: keyboard });
    expect(FakeBroadcastTelegram.actions(telegram.texts.at(-1)?.keyboard)).toContain(`bc:clear:${id}`);
  });

  it('points to the broken line', async () => {
    const id = await draftWithContent();
    await service.handleAction(ADMIN, id, 'buttons', PANEL_MESSAGE);

    await service.handleMessage(ADMIN, message(101, { text: 'Без ссылки' }));
    await service.handleMessage(ADMIN, message(102, { text: undefined }));

    expect(telegram.texts.at(-2)?.html).toContain('Строка 1');
    expect(telegram.texts.at(-1)?.html).toContain('текстом');
    expect((await repos.broadcasts.findById(id))?.status).toBe('awaiting_buttons');
  });

  it('keeps the old buttons when Telegram rejects the new ones', async () => {
    const id = await draftWithContent();
    await service.handleAction(ADMIN, id, 'buttons', PANEL_MESSAGE);
    telegram.outcomes.set(ADMIN, [{ kind: 'failed', reason: 'Bad Request: BUTTON_URL_INVALID' }]);

    await service.handleMessage(ADMIN, message(101, { text: 'Сайт - https://example.com' }));

    expect(telegram.texts.at(-1)?.html).toContain('BUTTON_URL_INVALID');
    expect(await repos.broadcasts.findById(id)).toMatchObject({ status: 'awaiting_buttons', buttons: [] });
  });

  it('removes the buttons', async () => {
    const id = await draftWithContent();
    await service.handleAction(ADMIN, id, 'buttons', PANEL_MESSAGE);
    await service.handleMessage(ADMIN, message(101, { text: 'Магазин - shop' }));

    await service.handleAction(ADMIN, id, 'clear', PANEL_MESSAGE);

    expect((await repos.broadcasts.findById(id))?.buttons).toEqual([]);
    expect(telegram.copies.at(-1)?.keyboard).toEqual([]);
  });

  it('goes back to the panel', async () => {
    const id = await draftWithContent();
    await service.handleAction(ADMIN, id, 'buttons', PANEL_MESSAGE);

    await service.handleAction(ADMIN, id, 'back', PANEL_MESSAGE);

    expect((await repos.broadcasts.findById(id))?.status).toBe('draft');
    expect(FakeBroadcastTelegram.actions(telegram.edits.at(-1)?.keyboard)).toContain(`bc:send:${id}`);
  });
});

describe('BroadcastService sending', () => {
  it('asks to confirm with the number of recipients', async () => {
    const id = await draftWithContent();

    await service.handleAction(ADMIN, id, 'send', PANEL_MESSAGE);

    expect(telegram.edits.at(-1)?.html).toContain('<b>3</b>');
    expect(FakeBroadcastTelegram.actions(telegram.edits.at(-1)?.keyboard)).toEqual([`bc:confirm:${id}`, `bc:back:${id}`]);
  });

  it('starts sending once, turning the confirmation into the progress message', async () => {
    const id = await draftWithContent();
    await service.handleAction(ADMIN, id, 'send', PANEL_MESSAGE);

    await service.handleAction(ADMIN, id, 'confirm', PANEL_MESSAGE);
    await expectStale(service.handleAction(ADMIN, id, 'confirm', PANEL_MESSAGE));

    expect(await repos.broadcasts.findById(id)).toMatchObject({
      status: 'sending',
      total: 3,
      progressMessageId: PANEL_MESSAGE,
      cursorUserId: null,
    });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(FakeBroadcastTelegram.actions(telegram.edits.at(-1)?.keyboard)).toEqual([`bc:stop:${id}`]);
  });

  it('refuses to send when nobody started the bot', async () => {
    const empty = createMemoryRepositories();
    const lonely = new BroadcastService({
      broadcasts: empty.broadcasts,
      users: empty.users,
      telegram,
      runner: { wake, cancel },
      webAppUrl: WEBAPP,
      logger: silentLogger,
    });
    await lonely.begin(ADMIN);
    await lonely.handleMessage(ADMIN, message(100));
    const draft = await empty.broadcasts.findOpenDraft(ADMIN);

    await expect(lonely.handleAction(ADMIN, draft?.id ?? 0, 'send', PANEL_MESSAGE)).rejects.toThrow(/некому/);
    await expect(lonely.handleAction(ADMIN, draft?.id ?? 0, 'confirm', PANEL_MESSAGE)).rejects.toThrow(/некому/);
  });

  it('stops a running broadcast', async () => {
    const id = await draftWithContent();
    await service.handleAction(ADMIN, id, 'confirm', PANEL_MESSAGE);

    await service.handleAction(ADMIN, id, 'stop', PANEL_MESSAGE);

    expect((await repos.broadcasts.findById(id))?.status).toBe('cancelled');
    expect(cancel).toHaveBeenCalledWith(id);
    await expectStale(service.handleAction(ADMIN, id, 'stop', PANEL_MESSAGE));
  });

  it('still sends when the progress message cannot be shown', async () => {
    const id = await draftWithContent();
    vi.spyOn(telegram, 'editText').mockRejectedValue(new Error('Bad Request: message to edit not found'));

    await service.handleAction(ADMIN, id, 'confirm', PANEL_MESSAGE);

    expect((await repos.broadcasts.findById(id))?.status).toBe('sending');
    expect(wake).toHaveBeenCalledTimes(1);
  });

  it('cancels a draft', async () => {
    const id = await draftWithContent();

    await service.handleAction(ADMIN, id, 'cancel', PANEL_MESSAGE);

    expect((await repos.broadcasts.findById(id))?.status).toBe('cancelled');
    expect(telegram.edits.at(-1)).toMatchObject({ html: 'Рассылка отменена.', keyboard: undefined });
    await expectStale(service.handleAction(ADMIN, id, 'send', PANEL_MESSAGE));
  });

  it("never lets an admin act on another admin's broadcast", async () => {
    const id = await draftWithContent();

    await expectStale(service.handleAction(OTHER_ADMIN, id, 'cancel', PANEL_MESSAGE));
    await expectStale(service.handleAction(ADMIN, 999, 'cancel', PANEL_MESSAGE));
    expect((await repos.broadcasts.findById(id))?.status).toBe('draft');
  });
});
