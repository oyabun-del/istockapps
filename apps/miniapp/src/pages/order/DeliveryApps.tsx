import type { DeliveryAppDto, DeliveryDto, DeliveryGroupDto, DeliveryState } from '@istock/shared';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { formatDeadline } from '../../lib/format';
import type { IconName } from '../../lib/icons';
import { openExternalLink } from '../../lib/telegram';

const STATE_NOTICE: Record<Exclude<DeliveryState, 'available'>, { icon: IconName; text: string; tone: string }> = {
  replacing: {
    icon: 'autorenew',
    text: 'Аккаунт заблокирован Apple. Подбираем замену бесплатно — ссылки появятся здесь автоматически.',
    tone: 'bg-secondary-container/15 text-secondary',
  },
  revoked: {
    icon: 'lock',
    text: 'Доступ к этому аккаунту закрыт. Напишите в поддержку — поможем.',
    tone: 'bg-error-container/40 text-error',
  },
  expired: {
    icon: 'timer_off',
    text: 'Срок выдачи истёк. Напишите в поддержку, если не успели установить приложение.',
    tone: 'bg-surface-container-highest text-on-surface-variant',
  },
  unavailable: {
    icon: 'error',
    text: 'Ссылка временно недоступна. Обновите страницу чуть позже.',
    tone: 'bg-warning/10 text-warning',
  },
};

function StateNotice({ state, message }: { state: Exclude<DeliveryState, 'available'>; message: string | null }) {
  const notice = STATE_NOTICE[state];
  // The API's own explanation is shown for revoked access only; the other texts are ours.
  const text = state === 'revoked' && message ? message : notice.text;
  return (
    <p role="status" className={`flex items-start gap-1.5 rounded-lg p-space-sm text-body-sm ${notice.tone}`}>
      <Icon name={notice.icon} className="mt-0.5 text-[16px]" />
      {text}
    </p>
  );
}

type AppLinksProps = {
  app: DeliveryAppDto;
  group: DeliveryGroupDto;
  isDone: boolean;
  hasManyApps: boolean;
};

function AppLinks({ app, group, isDone, hasManyApps }: AppLinksProps) {
  const title = hasManyApps ? <span className="text-label-lg text-on-surface">{app.name}</span> : null;
  if (app.state !== 'available' || !app.links) {
    return (
      <div className="flex flex-col gap-1.5">
        {title}
        <StateNotice state={app.state === 'available' ? 'unavailable' : app.state} message={group.message} />
      </div>
    );
  }
  const { main, reserve } = app.links;
  return (
    <div className="flex flex-col gap-1.5">
      {title}
      <Button isFullWidth variant={isDone ? 'secondary' : 'primary'} icon="download" onClick={() => openExternalLink(main)}>
        Скачать
      </Button>
      <Button isFullWidth variant="ghost" icon="open_in_new" onClick={() => openExternalLink(reserve)}>
        Резервная ссылка
      </Button>
    </div>
  );
}

type Props = {
  delivery: DeliveryDto;
  isDone: boolean;
};

/** Links of every app in the current snapshot; positions are never merged with older snapshots. */
export function DeliveryApps({ delivery, isDone }: Props) {
  const entries = delivery.groups.flatMap((group) => group.apps.map((app) => ({ app, group })));
  const hasAvailable = entries.some(({ app }) => app.state === 'available');
  return (
    <div className="flex flex-col gap-space-sm">
      {delivery.isSandbox && (
        <span className="self-start rounded-full bg-warning/15 px-space-sm py-0.5 text-label-sm text-warning">
          Тестовый режим: оплата поставщику не начисляется
        </span>
      )}
      {entries.map(({ app, group }) => (
        <AppLinks key={`${group.id}:${app.id}`} app={app} group={group} isDone={isDone} hasManyApps={entries.length > 1} />
      ))}
      {isDone && hasAvailable && (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
          <Icon name="warning" className="mt-0.5 text-[16px]" />
          Нажимайте, только если загрузка не завершилась. Установленное и удалённое приложение скачать повторно нельзя.
        </p>
      )}
      {hasAvailable && (
        <p className="tabular flex items-center gap-1.5 text-label-md text-secondary">
          <Icon name="schedule" className="text-[16px]" />
          {`Ссылки действуют до ${formatDeadline(delivery.expiresAt)}`}
        </p>
      )}
    </div>
  );
}
