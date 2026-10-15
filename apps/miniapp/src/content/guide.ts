/**
 * Instruction copy for our delivery flow (PLAN.md): the buyer downloads the app,
 * signs in to our Apple ID in the App Store only, enters the code and launches
 * the app, then returns to their own Apple ID. No certificates or profiles.
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

export interface GuideStep {
  title: string;
  text: string;
  /** Settings path shown as a breadcrumb, if any. */
  path?: readonly string[];
  note?: string;
}

export const SAFETY_RULES: readonly string[] = [
  'Данные из заказа только для App Store: никогда не входите с ними в iCloud, иначе iPhone может заблокироваться.',
  'Не меняйте пароль, почту и настройки выданного аккаунта.',
  'Выключите «Сгружать неиспользуемые» (Настройки → App Store), иначе iPhone может сам удалить приложение.',
  'Выключите автообновление приложений там же, в Настройки → App Store: обновить приложение можно только через выданный аккаунт.',
];

export const ACTIVATION_STEPS: readonly GuideStep[] = [
  {
    title: 'Скачайте приложение',
    text: 'После оплаты откройте заказ и нажмите «Скачать». Дождитесь окончания загрузки и нажмите в заказе «Я скачал».',
  },
  {
    title: 'Выйдите из своего Apple ID в App Store',
    text: 'Нажмите «Выйти» в разделе «Медиаматериалы и покупки». Выход только из App Store: iCloud, фото и контакты остаются на месте.',
    path: [...MEDIA_PURCHASES_PATH, 'Выйти'],
  },
  {
    title: 'Войдите по данным из заказа',
    text: 'В заказе нажмите «Получить логин и пароль» и скопируйте их. Снова откройте «Медиаматериалы и покупки» и войдите с этими данными.',
    path: MEDIA_PURCHASES_PATH,
    note: 'Входите только в «Медиаматериалы и покупки». Никогда не входите с этими данными в iCloud.',
  },
  {
    title: 'Введите код подтверждения',
    text: 'Когда iPhone попросит код, нажмите в заказе «Получить код» и сразу введите 6 цифр. Новый код можно запросить через 30 секунд.',
  },
  {
    title: 'Откройте приложение',
    text: 'Запустите приложение с экрана «Домой». Если оно открылось, нажмите в заказе «Приложение работает».',
  },
  {
    title: 'Верните свой Apple ID',
    text: 'Снова выйдите в «Медиаматериалы и покупки» и войдите в свой Apple ID. Приложение останется на iPhone и продолжит работать.',
    path: [...MEDIA_PURCHASES_PATH, 'Выйти'],
  },
];

export const FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'Код не приходит или не подходит',
    answer:
      'Код действует недолго, вводите его сразу. Подождите 30 секунд и нажмите в заказе «Запросить новый код». Если не помогло, напишите в поддержку и укажите номер заказа.',
  },
  {
    question: 'Приложение просит войти снова',
    answer:
      'Повторите шаги 2–4 с данными из того же заказа: он хранится в разделе «Мои загрузки». После запуска приложения снова верните свой Apple ID.',
  },
  {
    question: 'Я удалил приложение',
    answer: 'Откройте тот же заказ в «Мои загрузки», нажмите «Скачать снова» и пройдите активацию заново. Платить повторно не нужно.',
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
