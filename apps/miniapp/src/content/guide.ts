/**
 * Instruction copy for our delivery flow (PLAN.md): the buyer downloads the app,
 * turns on the code wait, signs in to our Apple ID in the App Store only, enters
 * the code and launches the app, then returns to their own Apple ID. No certificates
 * or profiles. A download is handed out once: no re-download after deletion or activation.
 * Keep in sync with the order screen (pages/order/DeliverySteps.tsx).
 */

import downloadSrc from '../assets/guide/download.svg';
import enterCodeSrc from '../assets/guide/enter-code.svg';
import openAppSrc from '../assets/guide/open-app.svg';
import signBackInSrc from '../assets/guide/sign-back-in.svg';
import signOutSrc from '../assets/guide/sign-out.svg';

/**
 * The Settings item where App Store sign-in lives, as iOS names it; the guide marks it with the
 * App Store icon (components/ui/RichText.tsx). iCloud is configured elsewhere and must not be touched.
 */
export const APP_STORE_SECTION = 'Контент и покупки';

export const APP_STORE_SECTION_PATH = ['Настройки', 'Ваше имя', APP_STORE_SECTION] as const;

export const QUICK_STEPS = [
  'Оплатите заказ удобным способом',
  'Скачайте приложение — оно заработает только после всех шагов',
  'Войдите в App Store по данным из заказа и введите код',
  'Откройте приложение, затем верните свой Аккаунт Apple',
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
 * Schematics show only what happens on the iPhone outside the Mini App: the buttons of the Mini
 * App are already on screen, so a step done entirely inside it has no picture. Shared by the
 * guide and the order screen; swap the files for screenshots or a video without touching the copy.
 */
export const GUIDE_IMAGES = {
  download: {
    src: downloadSrc,
    alt: 'Схема: на экране «Домой» значок приложения загружается; дождитесь, пока загрузка закончится.',
  },
  signOut: {
    src: signOutSrc,
    alt: `Схема: в Настройках нажмите на своё имя, затем «${APP_STORE_SECTION}» и в меню «Выйти». iCloud и «Выйти» внизу экрана с именем не трогайте.`,
  },
  enterCode: {
    src: enterCodeSrc,
    alt: `Схема: в «${APP_STORE_SECTION}» войдите с логином и паролем из заказа и введите 6 цифр кода.`,
  },
  openApp: {
    src: openAppSrc,
    alt: 'Схема: на экране «Домой» нажмите на значок приложения и убедитесь, что оно открылось.',
  },
  signBackIn: {
    src: signBackInSrc,
    alt: `Схема: в «${APP_STORE_SECTION}» нажмите «Выйти» и войдите в свой Аккаунт Apple.`,
  },
} as const satisfies Record<string, GuideImage>;

export interface GuideStep {
  title: string;
  /** The one thing to do on this step, highlighted above the explanation. */
  action: string;
  /** Only what the buyer must know and the action does not say: a condition or a consequence. */
  text?: string;
  /** The iPhone screen outside the Mini App; absent when the whole step is done inside it. */
  image?: GuideImage;
  /** Settings path shown as a one-line breadcrumb; only where the action does not name the way there. */
  path?: readonly string[];
  /**
   * Tap-by-tap walkthrough for a step done in iPhone Settings, from opening them to checking the
   * result. Same «Label» convention as the rest of the copy; replaces `path`, which it spells out.
   */
  substeps?: readonly string[];
  note?: string;
}

/** Breaking it can lock the buyer's iPhone, so the guide shows it apart from the other rules. */
export const CRITICAL_SAFETY_RULE =
  'Данные из заказа вводите только в App Store, не в iCloud: иначе iPhone может заблокироваться.';

/** iOS 18+ (incl. iOS 26) keeps app settings under Settings → Apps. Also the buyer's obligations in terms.ts. */
export const SAFETY_RULES: readonly string[] = [
  CRITICAL_SAFETY_RULE,
  'Не удаляйте и не обновляйте приложение: скачать его повторно по этому заказу нельзя.',
  'В Настройки → Приложения → App Store выключите «Сгружать неиспользуемые» и «Обновления приложений».',
];

/** Steps 1, 3 and 4 match the order screen; signing out and back in happen outside the Mini App. */
export const ACTIVATION_STEPS: readonly GuideStep[] = [
  {
    title: 'Скачайте приложение',
    action: 'Нажмите в заказе «Скачать», дождитесь загрузки и нажмите «Я скачал»',
    image: GUIDE_IMAGES.download,
  },
  {
    title: 'Выйдите из App Store',
    action: `Выйдите из «${APP_STORE_SECTION}», iCloud не трогайте`,
    substeps: [
      'Сверните Telegram и откройте «Настройки»',
      'Нажмите на своё имя в самом верху',
      `Нажмите «${APP_STORE_SECTION}»`,
      'В меню нажмите «Выйти». Нет кнопки — нажмите «Просмотреть учётную запись» и прокрутите вниз',
      'Подтвердите: ещё раз нажмите «Выйти»',
      `Готово, если «${APP_STORE_SECTION}» теперь предлагают войти. Вернитесь в Telegram к заказу`,
    ],
    image: GUIDE_IMAGES.signOut,
    note: 'Не нажимайте «Выйти» внизу экрана с вашим именем: это выход из всего Аккаунта Apple, вместе с iCloud и «Локатором».',
  },
  {
    title: 'Войдите по данным заказа',
    action: 'Нажмите «Получить логин и пароль», затем «Включить ожидание кода», войдите и введите код',
    text: 'Ожидание включайте до входа, иначе код не придёт. Входите только в App Store, не в iCloud.',
    image: GUIDE_IMAGES.enterCode,
  },
  {
    title: 'Откройте приложение',
    action: 'Запустите приложение и нажмите в заказе «Приложение работает»',
    image: GUIDE_IMAGES.openApp,
    note: 'Нажимайте, только если приложение открылось: потом логин и пароль скроются.',
  },
  {
    title: 'Верните свой аккаунт',
    action: `В «${APP_STORE_SECTION}» нажмите «Выйти» и войдите в свой Аккаунт Apple`,
    substeps: [
      'Откройте «Настройки» и нажмите на своё имя вверху',
      `Нажмите «${APP_STORE_SECTION}», затем «Выйти» и подтвердите`,
      `Снова нажмите «${APP_STORE_SECTION}» и войдите в свой Аккаунт Apple. iPhone предложит его сам — нажмите «Продолжить»`,
      'Готово, если в App Store под значком аккаунта вверху справа ваш адрес',
    ],
    image: GUIDE_IMAGES.signBackIn,
  },
];

export const FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'Код не приходит или не подходит',
    answer:
      'Включите ожидание до входа в App Store и вводите код сразу: он действует недолго. Истёк — нажмите «Включить ожидание кода» ещё раз и снова войдите. Apple не спросил код — нажмите «Apple не запросил код». Видите «Лимит кодов исчерпан» — напишите в поддержку с номером заказа.',
  },
  {
    question: 'Нет кнопки «Выйти»',
    answer:
      `В iOS 26.5 и новее она может быть спрятана: в «${APP_STORE_SECTION}» нажмите «Просмотреть учётную запись» и прокрутите вниз.`,
  },
  {
    question: 'Я удалил приложение',
    answer:
      'По этому заказу скачать его повторно нельзя, нужен новый заказ. Чтобы iPhone не удалил приложение сам, выключите «Сгружать неиспользуемые» в Настройки → Приложения → App Store.',
  },
  {
    question: 'Приложение просит войти снова',
    answer:
      'Активация не завершена — войдите с данными того же заказа. Завершена — напишите в поддержку с номером заказа.',
  },
  {
    question: 'Оплатил, но заказ не обновился',
    answer: 'Статус обновится сам в течение минуты. Не обновился — напишите в поддержку.',
  },
];
