import { LEGAL_PATHS } from '@istock/shared';
import type { InlineKeyboard } from 'grammy';

/** The documents stay readable before subscribing, so every entry keyboard offers them. */
export function withLegalButtons(keyboard: InlineKeyboard, webAppUrl: string): InlineKeyboard {
  return keyboard
    .row()
    .webApp('📄 Пользовательское соглашение', `${webAppUrl}#${LEGAL_PATHS.terms}`)
    .row()
    .webApp('🔒 Политика конфиденциальности', `${webAppUrl}#${LEGAL_PATHS.privacy}`);
}
