import type { Broadcast, InlineButton, Keyboard } from '../domain/models.js';
import { escapeHtml } from '../lib/html.js';

export const BROADCAST_ACTIONS = ['edit', 'buttons', 'clear', 'send', 'confirm', 'back', 'cancel', 'stop'] as const;
export type BroadcastAction = (typeof BROADCAST_ACTIONS)[number];

/** Callback data: bc:<action>:<broadcastId>. */
export const BROADCAST_ACTION_PATTERN = new RegExp(`^bc:(${BROADCAST_ACTIONS.join('|')}):(\\d+)$`);

function action(text: string, name: BroadcastAction, id: number): InlineButton {
  return { kind: 'callback', text, data: `bc:${name}:${id}` };
}

export const BROADCAST_KEYBOARD = {
  awaitingContent: (id: number): Keyboard => [[action('✖ Отмена', 'cancel', id)]],
  awaitingButtons: (id: number): Keyboard => [[action('← Назад', 'back', id)]],
  panel: (broadcast: Broadcast): Keyboard => [
    [action('✏️ Изменить сообщение', 'edit', broadcast.id), action('🔘 Кнопки', 'buttons', broadcast.id)],
    ...(broadcast.buttons.length > 0 ? [[action('🗑 Убрать кнопки', 'clear', broadcast.id)]] : []),
    [action('🚀 Отправить', 'send', broadcast.id), action('✖ Отмена', 'cancel', broadcast.id)],
  ],
  confirm: (id: number): Keyboard => [[action('✅ Да, отправить', 'confirm', id), action('← Назад', 'back', id)]],
  progress: (id: number): Keyboard => [[action('⏹ Остановить', 'stop', id)]],
};

const count = (value: number): string => value.toLocaleString('ru-RU');

function processed(broadcast: Broadcast): number {
  return broadcast.sent + broadcast.blocked + broadcast.failed;
}

function counters(broadcast: Broadcast): string {
  return (
    `✅ Доставлено: <b>${count(broadcast.sent)}</b>\n` +
    `🚫 Заблокировали бота: ${count(broadcast.blocked)}\n` +
    `⚠️ Ошибки: ${count(broadcast.failed)}`
  );
}

const FINAL_TITLES: Partial<Record<Broadcast['status'], (id: number) => string>> = {
  done: (id) => `✅ <b>Рассылка #${id} завершена</b>`,
  cancelled: (id) => `⏹ <b>Рассылка #${id} остановлена</b>`,
  failed: (id) => `⚠️ <b>Рассылка #${id} прервана</b>`,
};

/** Why the worker gave up on a broadcast. */
export type FailureReason = 'source_missing' | 'failing';

const FAILURE_REASONS: Record<FailureReason, string> = {
  source_missing: 'исходное сообщение удалено',
  failing: 'Telegram отклоняет все копии, проверьте сообщение и кнопки',
};

export const BROADCAST_TEXT = {
  askContent:
    '📣 <b>Новая рассылка</b>\n\n' +
    'Пришлите сообщение, которое получат пользователи: текст, фото, видео, GIF или файл с подписью. ' +
    'Форматирование, ссылки и эмодзи сохранятся как есть.\n\n' +
    'Не удаляйте это сообщение, пока рассылка не закончится: бот копирует именно его.',
  askButtons:
    '🔘 <b>Кнопки</b>\n\nПришлите их одним сообщением, одна строка — один ряд:\n\n' +
    '<code>Открыть магазин - shop</code>\n' +
    '<code>Канал - https://t.me/channel | Поддержка - https://t.me/support</code>\n\n' +
    '<code>shop</code> открывает магазин, <code>app:ID</code> открывает приложение в магазине. ' +
    'Кнопки одного ряда разделяются <code>|</code>.',
  panel: (broadcast: Broadcast): string =>
    `👆 Так рассылку #${broadcast.id} увидят пользователи.\n` +
    (broadcast.buttons.length > 0 ? 'Проверьте кнопки, нажав на них.' : 'Кнопок нет.'),
  confirm: (recipients: number): string =>
    `Отправить рассылку <b>${count(recipients)}</b> пользователям? Остановить её можно в любой момент.`,
  progress: (broadcast: Broadcast): string =>
    `📤 <b>Рассылка #${broadcast.id}</b>: ${count(processed(broadcast))} из ${count(broadcast.total)}\n\n${counters(broadcast)}`,
  report: (broadcast: Broadcast, reason: FailureReason = 'source_missing'): string => {
    const base = FINAL_TITLES[broadcast.status]?.(broadcast.id) ?? `Рассылка #${broadcast.id}`;
    const title = broadcast.status === 'failed' ? `${base}: ${FAILURE_REASONS[reason]}` : base;
    return `${title}\nОбработано ${count(processed(broadcast))} из ${count(broadcast.total)}\n\n${counters(broadcast)}`;
  },
  cancelled: 'Рассылка отменена.',
  stopping: 'Останавливаю рассылку…',
  stale: 'Эта рассылка уже неактуальна.',
  failed: 'Не получилось, подробности в логе сервера.',
  noRecipients: 'Пока некому отправлять: ни один пользователь не запускал бота.',
  albumNotSupported: 'Альбомы разослать нельзя: кнопки к ним не прикрепляются. Пришлите одно фото или видео с подписью.',
  buttonsNeedText: 'Пришлите кнопки текстом. Пример выше.',
  buttonsInvalid: (error: string): string => `Не получилось разобрать кнопки. ${escapeHtml(error)}`,
  copyFailed: (reason: string): string =>
    `Telegram не принял это сообщение: <code>${escapeHtml(reason)}</code>\nПришлите другое.`,
  buttonsRejected: (reason: string): string =>
    `Telegram не принял кнопки: <code>${escapeHtml(reason)}</code>\nИсправьте их и пришлите снова.`,
} as const;
