import { escapeHtml } from '../lib/html.js';

export const BOT_TEXT = {
  welcome: (name: string): string =>
    `Привет, <b>${escapeHtml(name)}</b>! 👋\n\n` +
    'Здесь можно получить приложения, которые удалены из App Store или недоступны в вашем регионе.\n\n' +
    'Нажмите «Открыть магазин», чтобы выбрать приложение.',
  subscribeFirst: (channelUrl: string): string =>
    '📢 Чтобы пользоваться магазином, подпишитесь на наш канал:\n' +
    `${escapeHtml(channelUrl)}\n\n` +
    'После подписки нажмите <b>«Проверить подписку»</b>.',
  stillNotSubscribed: 'Подписка не найдена. Подпишитесь на канал и попробуйте снова.',
  thanks: 'Спасибо за подписку!',
  checkFailed: 'Не удалось проверить подписку. Попробуйте чуть позже.',
  support: 'Если что-то пошло не так, напишите в поддержку. Мы поможем.',
  partnerDisabled: 'Install-IOS не подключён: CATALOG_PROVIDER и DELIVERY_PROVIDER работают в режиме mock.',
  partnerFailed: 'Install-IOS сейчас не отвечает. Попробуйте позже, подробности в логе сервера.',
} as const;
