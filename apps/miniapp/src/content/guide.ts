/**
 * Instruction copy for our delivery flow (PLAN.md): the buyer downloads the app,
 * turns on the code wait, signs in to our Apple ID in the App Store only, enters
 * the code and launches the app, then returns to their own Apple ID. No certificates
 * or profiles. A download is handed out once: no re-download after deletion or activation.
 * Keep in sync with the order screen (pages/order/DeliverySteps.tsx).
 */

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
export interface GuideStep {
  title: string;
  /** The one thing to do on this step, highlighted above the explanation. */
  action: string;
  /** Why and what to watch for. */
  text: string;
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

export const ACTIVATION_STEPS: readonly GuideStep[] = [
  {
    title: 'Скачайте приложение',
    action: 'Нажмите в заказе «Скачать», затем «Я скачал»',
    text: 'Кнопка «Скачать» появится в заказе сразу после оплаты. Подтверждайте загрузку, только когда она закончится на iPhone.',
  },
  {
    title: 'Выйдите из своего Apple ID в App Store',
    action: 'Нажмите «Выйти» в «Медиаматериалы и покупки»',
    text: 'Выход только из App Store: iCloud, фото и контакты остаются на месте.',
    path: [...MEDIA_PURCHASES_PATH, 'Выйти'],
  },
  {
    title: 'Получите данные и включите ожидание кода',
    action: 'Нажмите «Получить логин и пароль», затем сразу «Включить ожидание кода»',
    text: 'Скопируйте логин и пароль. Код придёт в заказ, только если ожидание включено до входа. Время ожидания ограничено, на экране идёт таймер.',
  },
  {
    title: 'Войдите и введите код',
    action: 'Войдите с выданными данными в «Медиаматериалы и покупки» и введите код из заказа',
    text: 'Когда iPhone попросит код, он появится в заказе: нажмите на него, чтобы скопировать, и введите 6 цифр. Если Apple не спросил код, нажмите в заказе «Apple не запросил код».',
    path: MEDIA_PURCHASES_PATH,
    note: 'Входите только в «Медиаматериалы и покупки». Никогда не входите с этими данными в iCloud.',
  },
  {
    title: 'Откройте приложение',
    action: 'Запустите приложение и нажмите в заказе «Приложение работает»',
    text: 'Приложение лежит на экране «Домой».',
    note: 'Нажимайте, только когда приложение действительно открылось: после этого логин и пароль больше не показываются, а скачать приложение повторно нельзя.',
  },
  {
    title: 'Верните свой Apple ID',
    action: 'Выйдите в «Медиаматериалы и покупки» и войдите в свой Apple ID',
    text: 'Приложение останется на iPhone и продолжит работать.',
    path: [...MEDIA_PURCHASES_PATH, 'Выйти'],
  },
];

export const FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'Код не приходит или не подходит',
    answer:
      'Код приходит в заказ, только если ожидание включено до входа в App Store. Код действует недолго, вводите его сразу. Если ожидание закончилось или код истёк, нажмите «Включить ожидание кода» ещё раз и снова запросите код на iPhone. Число кодов для аккаунта ограничено: если видите «Лимит кодов исчерпан», напишите в поддержку и укажите номер заказа.',
  },
  {
    question: 'Я удалил приложение',
    answer:
      'Скачать его повторно по этому заказу нельзя: загрузка выдаётся один раз. Чтобы установить приложение снова, оформите новый заказ. Чтобы iPhone не удалил приложение сам, выключите «Сгружать неиспользуемые» в Настройки → App Store.',
  },
  {
    question: 'Можно ли скачать приложение ещё раз после активации?',
    answer:
      'Нет. После того как вы нажали «Приложение работает», логин и пароль больше не показываются, а скачать приложение повторно нельзя. Не удаляйте и не обновляйте его.',
  },
  {
    question: 'Приложение просит войти снова',
    answer:
      'Если активация ещё не завершена, войдите с данными из того же заказа в разделе «Мои загрузки». Если завершена, данные аккаунта больше не показываются: напишите в поддержку и укажите номер заказа.',
  },
  {
    question: 'Безопасно ли выходить из своего Apple ID?',
    answer:
      'Да. Вы выходите только из App Store, а iCloud, фото, контакты и ваши покупки не затрагиваются. После активации вы входите обратно.',
  },
  {
    question: 'Оплатил, но заказ не обновился',
    answer: 'Статус обновляется автоматически в течение минуты. Если этого не произошло, напишите в поддержку.',
  },
];
