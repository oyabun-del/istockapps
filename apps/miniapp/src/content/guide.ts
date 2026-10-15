/**
 * Instruction copy. Assumes the flow from PLAN.md: the buyer signs in to our
 * Apple ID in the App Store only, enters the code and launches the app.
 * Edit here when the delivery API defines the final procedure.
 */

export const QUICK_STEPS = [
  'Оплатите заказ удобным способом',
  'Скачайте приложение по ссылке и подтвердите загрузку',
  'Войдите в App Store по выданным данным и введите код',
  'Откройте приложение, и оно активируется',
] as const;

export interface GuideStep {
  title: string;
  text: string;
  /** Settings path shown as a breadcrumb, if any. */
  path?: readonly string[];
  note?: string;
}

export const ACTIVATION_STEPS: readonly GuideStep[] = [
  {
    title: 'Скачайте приложение',
    text: 'После оплаты в заказе появится кнопка «Скачать». Дождитесь, пока загрузка завершится, и нажмите «Я скачал».',
  },
  {
    title: 'Выйдите из Apple ID в App Store',
    text: 'Выходите только из App Store. Ваш iCloud, фото и контакты не затрагиваются.',
    path: ['Настройки', 'Ваше имя', 'Медиаматериалы и покупки', 'Выйти'],
  },
  {
    title: 'Войдите по выданным данным',
    text: 'Скопируйте логин и пароль из заказа и войдите в том же разделе «Медиаматериалы и покупки». Когда iPhone попросит код, нажмите в заказе «Получить код».',
    note: 'Никогда не входите с этими данными в iCloud: это может заблокировать устройство.',
  },
  {
    title: 'Откройте приложение',
    text: 'Запустите приложение, и оно активируется. После этого выйдите из выданного аккаунта и вернитесь в свой Apple ID.',
  },
];

export const FAQ: readonly { question: string; answer: string }[] = [
  {
    question: 'Код не приходит',
    answer: 'Подождите 30 секунд и нажмите «Запросить новый код». Если не помогло, напишите в поддержку и укажите номер заказа.',
  },
  {
    question: 'Приложение просит войти снова',
    answer: 'Повторите вход по данным из заказа. Они хранятся в разделе «Мои загрузки».',
  },
  {
    question: 'Оплатил, но заказ не обновился',
    answer: 'Статус обновляется автоматически в течение минуты. Если этого не произошло, напишите в поддержку.',
  },
];
