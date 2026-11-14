import type { CategoryDto } from '@istock/shared';
import { ALL_CATEGORY } from './catalog-provider.js';

/**
 * Install-IOS sends no categories, so the shop assigns them by app name.
 * Order here is the order of the chips in the Mini App.
 */
export const APP_CATEGORY_IDS = ['banks', 'vpn', 'ai', 'movies', 'social', 'games', 'other'] as const;
export type AppCategoryId = (typeof APP_CATEGORY_IDS)[number];

export const OTHER_CATEGORY: AppCategoryId = 'other';

const TITLES: Record<AppCategoryId, Omit<CategoryDto, 'id'>> = {
  banks: { title: 'Банки', icon: 'account_balance' },
  vpn: { title: 'VPN', icon: 'vpn_lock' },
  ai: { title: 'Нейросети', icon: 'auto_awesome' },
  movies: { title: 'Кино и сериалы', icon: 'movie' },
  social: { title: 'Соцсети', icon: 'forum' },
  games: { title: 'Игры', icon: 'sports_esports' },
  other: { title: 'Другое', icon: 'apps' },
};

export const ALL_CATEGORY_DTO: CategoryDto = { id: ALL_CATEGORY, title: 'Все', icon: 'grid_view' };

export function categoryDto(id: AppCategoryId): CategoryDto {
  return { id, ...TITLES[id] };
}

const NOT_WORD = '[^\\p{L}\\p{N}]';

/**
 * Whole words by default, so "ai" does not find "Airbnb"; a trailing `*` matches the start of a word
 * instead: "сбер*" finds "СберБанк".
 */
function words(...list: string[]): RegExp {
  const parts = list.map((entry) => {
    const isStem = entry.endsWith('*');
    const escaped = (isStem ? entry.slice(0, -1) : entry).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return isStem ? escaped : `${escaped}(?=${NOT_WORD}|$)`;
  });
  return new RegExp(`(?:^|${NOT_WORD})(?:${parts.join('|')})`, 'iu');
}

/** Rules in priority order: the first match wins. */
const RULES: ReadonlyArray<readonly [AppCategoryId, RegExp]> = [
  ['vpn', /vpn|proxy|прокси/iu],
  [
    'ai',
    words('chatgpt', 'gpt*', 'openai', 'claude', 'gemini', 'perplexity', 'deepseek', 'midjourney', 'grok', 'copilot',
      'gigachat', 'гигачат', 'алиса', 'нейро*', 'ai', 'ии'),
  ],
  [
    'banks',
    words('банк*', 'bank*', 'сбер*', 'sber*', 'тинькофф', 'tinkoff', 'т-банк', 't-bank', 'втб', 'vtb', 'альфа*', 'alfa*',
      'газпромбанк', 'райффайзен*', 'raiffeisen*', 'открытие', 'совкомбанк', 'халва', 'росбанк', 'мкб', 'псб', 'psb',
      'россельхоз*', 'уралсиб', 'ак барс', 'юmoney', 'yoomoney', 'mir pay', 'мир pay', 'сбп'),
  ],
  [
    'movies',
    words('кинопоиск', 'kinopoisk', 'okko', 'иви', 'ivi', 'wink', 'premier', 'кион', 'kion', 'амедиатека',
      'amediateka', 'more.tv', 'netflix', 'hbo', 'disney*', 'кино*', 'фильм*', 'сериал*', 'rutube', 'youtube', 'twitch'),
  ],
  [
    'social',
    words('telegram*', 'телеграм*', 'whatsapp*', 'instagram', 'вконтакте', 'vk', 'одноклассники', 'ok', 'max', 'tiktok',
      'facebook', 'messenger', 'discord', 'threads', 'twitter', 'snapchat', 'viber', 'signal', 'дзен'),
  ],
  [
    'games',
    words('game*', 'игр*', 'roblox', 'minecraft', 'brawl stars', 'clash*', 'pubg*', 'standoff*', 'genshin*', 'fortnite'),
  ],
];

/** A manual override by app id wins over the name rules; unmatched apps go to "other". */
export function categorize(
  app: { id: string; name: string },
  overrides: Readonly<Record<string, AppCategoryId>> = {},
): AppCategoryId {
  const override = overrides[app.id];
  if (override) return override;
  return RULES.find(([, pattern]) => pattern.test(app.name))?.[0] ?? OTHER_CATEGORY;
}

/** "Все" plus every non-empty category; a single category is no filter, so then only "Все". */
export function visibleCategories(usedIds: ReadonlySet<string>): CategoryDto[] {
  const used = APP_CATEGORY_IDS.filter((id) => usedIds.has(id));
  return [ALL_CATEGORY_DTO, ...(used.length > 1 ? used.map(categoryDto) : [])];
}
