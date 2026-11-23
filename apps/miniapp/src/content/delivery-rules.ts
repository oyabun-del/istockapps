/**
 * Rules of the delivery the buyer accepts in the cart and sees again in the order. Keep in sync with
 * sections 4 and 6 of content/terms.ts. Limits come from the delivery API (Install-IOS): before the
 * first code request the order lives `installSeconds`, the first request shortens it, links included,
 * to `activationSeconds` from that moment.
 */
import type { DeliveryLimitsDto } from '@istock/shared';
import { formatDuration } from '../lib/format';

export const RULES_CONSEQUENCE =
  'Если шаг пропущен, выполнен не по инструкции или срок истёк, мы не можем гарантировать работу приложения и не возвращаем деньги.';

export const RULES_CONSENT_LABEL =
  'Я пройду шаги строго по инструкции и уложусь в срок. Понимаю, что иначе работа приложения не гарантируется и деньги не возвращаются.';

export function deliveryTimeText(limits: DeliveryLimitsDto | null | undefined): string {
  if (!limits) return 'На скачивание и активацию отводится ограниченное время, оно указано в заказе.';
  return (
    `На скачивание и вход в App Store — ${formatDuration(limits.installSeconds)}. ` +
    `После первого запроса кода на завершение остаётся ${formatDuration(limits.activationSeconds)}: ` +
    'срок заказа и ссылок сокращается.'
  );
}

export function activationWarningText(activationSeconds: number): string {
  return (
    `После запроса кода на завершение активации останется ${formatDuration(activationSeconds)}. ` +
    'Ссылки на скачивание тоже перестанут работать раньше.'
  );
}
