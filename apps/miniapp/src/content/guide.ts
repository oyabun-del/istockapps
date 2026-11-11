/**
 * Instruction copy for our delivery flow (PLAN.md): the buyer downloads the app,
 * turns on the code wait, signs in to our Apple ID in the App Store only, enters
 * the code and launches the app, then returns to their own Apple ID. No certificates
 * or profiles. A download is handed out once: no re-download after deletion or activation.
 * Keep in sync with the order screen (pages/order/DeliverySteps.tsx).
 */

import credentialsSrc from '../assets/guide/credentials.svg';
import downloadSrc from '../assets/guide/download.svg';
import enterCodeSrc from '../assets/guide/enter-code.svg';
import openAppSrc from '../assets/guide/open-app.svg';
import signBackInSrc from '../assets/guide/sign-back-in.svg';
import signOutSrc from '../assets/guide/sign-out.svg';

/** Where App Store sign-in lives; iCloud is configured elsewhere and must not be touched. */
export const MEDIA_PURCHASES_PATH = ['Настройки', 'Ваше имя', 'Медиаматериалы и покупки'] as const;

export const QUICK_STEPS = [
  'Оплатите заказ удобным способом',
  'Скачайте приложение и подтвердите загрузку',
  'Войдите в App Store по данным из заказа и введите код',
  'Откройте приложение, затем верните свой Apple ID',
] as const;

/**
 * Copy convention: «Label» names a button or a Settings item the buyer taps; the guide shows it
 * as a chip (components/ui/RichText.tsx). Keep labels identical to the order screen.
 */
/** Schematic of the screen for a step: what to tap, numbered in order. */
export interface GuideImage {
  src: string;
  /** Describes the taps in order, for screen readers. */
  alt: string;
}

/**
 * One per screen, shared by the guide and the order screen. Schematics for now; swap the files
 * for screenshots or a video without touching the copy.
 */
export const GUIDE_IMAGES = {
  download: {
    src: downloadSrc,
    alt: 'Схема: в заказе нажмите «Скачать», дождитесь конца загрузки и нажмите «Я скачал».',
  },
  signOut: {
    src: signOutSrc,
    alt: 'Схема: в Настройках откройте «Медиаматериалы и покупки» и нажмите «Выйти». iCloud не трогайте.',
  },
  credentials: {
    src: credentialsSrc,
    alt: 'Схема: в заказе нажмите «Получить логин и пароль» и скопируйте логин и пароль.',
  },
  enterCode: {
    src: enterCodeSrc,
    alt: 'Схема: нажмите «Включить ожидание кода», скопируйте код из заказа и введите 6 цифр на iPhone.',
  },
  openApp: {
    src: openAppSrc,
    alt: 'Схема: откройте приложение на экране «Домой», затем нажмите в заказе «Приложение работает».',
  },
  signBackIn: {
    src: signBackInSrc,
    alt: 'Схема: в «Медиаматериалы и покупки» нажмите «Выйти» и войдите со своим Apple ID.',
  },
} as const satisfies Record<string, GuideImage>;

export interface GuideStep {
  title: string;
  /** The one thing to do on this step, highlighted above the explanation. */
  action: string;
  /** Only what the buyer must know: a condition or a consequence. One or two short sentences. */
  text: string;
  /** Every step has a picture of the screen. */
  image: GuideImage;
  /** Settings path shown as a breadcrumb, if any. */
  path?: readonly string[];
  note?: string;
}

/** Breaking it can lock the buyer's iPhone, so the guide shows it apart from the other rules. */
export const CRITICAL_SAFETY_RULE =
  'Никогда не входите с данными из заказа в iCloud: iPhone может заблокироваться. Эти данные только для App Store.';

export const SAFETY_RULES: readonly string[] = [
  CRITICAL_SAFETY_RULE,
  'Не меняйте пароль, почту и настройки выданного аккаунта.',
  'Не удаляйте приложение после установки: скачать его повторно по этому заказу нельзя.',
  'Выключите «Сгружать неиспользуемые» (Настройки → App Store), иначе iPhone может сам удалить приложение.',
  'Выключите автообновление приложений там же, в Настройки → App Store, и не обновляйте приложение вручную: для обновления нужен выданный аккаунт, а после активации он недоступен.',
];

/** Same order as the order screen: download, credentials, code, open the app. */
export const ACTIVATION_STEPS: readonly GuideStep[] = [
  {
    title: 'Скачайте приложение',
    action: 'Нажмите в заказе «Скачать», дождитесь загрузки и нажмите «Я скачал»',
    text: 'Подтверждайте, только когда загрузка на iPhone закончилась.',
    image: GUIDE_IMAGES.download,
  },
  {
    title: 'Выйдите из своего Apple ID в App Store',
    action: 'Откройте «Медиаматериалы и покупки» и нажмите «Выйти»',
    text: 'iCloud, фото и контакты не затрагиваются.',
    image: GUIDE_IMAGES.signOut,
    path: [...MEDIA_PURCHASES_PATH, 'Выйти'],
  },
  {
    title: 'Получите логин и пароль',
    action: 'Нажмите в заказе «Получить логин и пароль» и скопируйте их',
    text: 'Пока не входите: сначала включите ожидание кода.',
    image: GUIDE_IMAGES.credentials,
  },
  {
    title: 'Включите ожидание и введите код',
    action: 'Нажмите «Включить ожидание кода», войдите в App Store и введите код из заказа',
    text: 'Код придёт в заказ, только если ожидание включено до входа. Нажмите на код, чтобы скопировать. Не спросили код? Нажмите «Apple не запросил код».',
    image: GUIDE_IMAGES.enterCode,
    path: MEDIA_PURCHASES_PATH,
    note: 'Входите только в «Медиаматериалы и покупки». Не в iCloud!',
  },
  {
    title: 'Откройте приложение',
    action: 'Запустите приложение и нажмите в заказе «Приложение работает»',
    text: 'Приложение на экране «Домой».',
    image: GUIDE_IMAGES.openApp,
    note: 'Нажимайте, только если приложение открылось: потом логин и пароль скроются, а скачать заново будет нельзя.',
  },
  {
    title: 'Верните свой Apple ID',
    action: 'Нажмите «Выйти» в «Медиаматериалы и покупки» и войдите со своим Apple ID',
    text: 'Приложение останется и продолжит работать.',
    image: GUIDE_IMAGES.signBackIn,
    path: [...MEDIA_PURCHASES_PATH, 'Выйти'],
  },
];

export const FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'Код не приходит или не подходит',
    answer:
      'Включите ожидание до входа в App Store и вводите код сразу: он действует недолго. Истёк — нажмите «Включить ожидание кода» ещё раз и снова запросите код на iPhone. Видите «Лимит кодов исчерпан» — напишите в поддержку с номером заказа.',
  },
  {
    question: 'Я удалил приложение',
    answer:
      'По этому заказу скачать его повторно нельзя, нужен новый заказ. Чтобы iPhone не удалил приложение сам, выключите «Сгружать неиспользуемые» в Настройки → App Store.',
  },
  {
    question: 'Можно ли скачать приложение ещё раз после активации?',
    answer: 'Нет. После «Приложение работает» логин и пароль скрываются, а повторная загрузка недоступна. Не удаляйте и не обновляйте приложение.',
  },
  {
    question: 'Приложение просит войти снова',
    answer:
      'Активация не завершена — войдите с данными того же заказа из «Мои загрузки». Завершена — напишите в поддержку с номером заказа.',
  },
  {
    question: 'Безопасно ли выходить из своего Apple ID?',
    answer: 'Да. Вы выходите только из App Store: iCloud, фото, контакты и покупки остаются. После активации войдёте обратно.',
  },
  {
    question: 'Оплатил, но заказ не обновился',
    answer: 'Статус обновится сам в течение минуты. Не обновился — напишите в поддержку.',
  },
];
