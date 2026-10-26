import { isPaidStatus } from '@istock/shared';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { Badge } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { api } from '../../lib/api';
import type { IconName } from '../../lib/icons';
import { queryKeys, useMe } from '../../lib/queries';
import { getTelegramProfile, openExternalLink, openTelegramLink } from '../../lib/telegram';

type ActionProps = {
  icon: IconName;
  title: string;
  hint: string;
  onClick?: () => void;
  to?: string;
};

const ROW_CLASSES =
  'flex w-full items-center gap-space-md px-space-lg py-3.5 text-left transition-colors hover:bg-surface-container-high active:bg-surface-container-high';

function ActionRow({ icon, title, hint, onClick, to }: ActionProps) {
  const content = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-primary">
        <Icon name={icon} className="text-[22px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label-lg text-on-surface">{title}</span>
        <span className="truncate text-body-sm text-on-surface-variant">{hint}</span>
      </span>
      <Icon name="chevron_right" className="text-[20px] text-outline" />
    </>
  );
  return to ? (
    <Link to={to} className={ROW_CLASSES}>
      {content}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={ROW_CLASSES}>
      {content}
    </button>
  );
}

function Stat({ testId, value, label }: { testId: string; value: number; label: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xl bg-surface-container py-space-md">
      <span data-testid={testId} className="tabular text-headline-lg text-on-surface">
        {value}
      </span>
      <span className="text-label-md text-on-surface-variant">{label}</span>
    </div>
  );
}

function Avatar({ name, photoUrl }: { name: string; photoUrl: string | null | undefined }) {
  const ring = 'ring-2 ring-primary-container/60 ring-offset-2 ring-offset-surface-container-high';
  if (photoUrl) {
    return <img src={photoUrl} alt="" width={64} height={64} className={`h-16 w-16 shrink-0 rounded-full object-cover ${ring}`} />;
  }
  return (
    <span
      className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-primary-container text-headline-lg text-white ${ring}`}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  );
}

function Menu({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Действия профиля" className="overflow-hidden rounded-xl bg-surface-container">
      <div className="flex flex-col divide-y divide-white/5">{children}</div>
    </nav>
  );
}

export function ProfilePage() {
  const { data: me } = useMe();
  const orders = useQuery({ queryKey: queryKeys.orders, queryFn: api.orders });
  const profile = getTelegramProfile();

  const name = me?.user.firstName ?? profile?.firstName ?? 'Гость';
  const username = me?.user.username ?? profile?.username;
  const photoUrl = me?.user.photoUrl ?? profile?.photoUrl;
  const purchased = orders.data?.filter((order) => isPaidStatus(order.status)).length ?? 0;
  const activated = orders.data?.filter((order) => order.status === 'completed').length ?? 0;

  return (
    <Page subtitle="Профиль">
      <div className="flex flex-col gap-space-lg">
        <section className="flex items-center gap-space-lg rounded-xl bg-surface-container-high p-space-lg">
          <Avatar name={name} photoUrl={photoUrl} />
          <div className="flex min-w-0 flex-col gap-1">
            <h1 className="truncate text-headline-md text-on-surface">{name}</h1>
            <span className="flex flex-wrap items-center gap-x-2 text-body-sm text-on-surface-variant">
              {username && <span>@{username}</span>}
              {me && <span className="tabular">ID {me.user.id}</span>}
            </span>
            {me?.isSubscribed && (
              <span className="mt-0.5">
                <Badge label="Подписка на канал активна" tone="success" icon="check_circle" />
              </span>
            )}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-space-sm">
          <Stat testId="stat-purchased" value={purchased} label="Куплено" />
          <Stat testId="stat-activated" value={activated} label="Активировано" />
        </div>

        <Menu>
          {me && (
            <ActionRow
              icon="support_agent"
              title="Служба поддержки"
              hint="Ответим в Telegram"
              onClick={() => openTelegramLink(me.supportUrl)}
            />
          )}
          <ActionRow icon="edit_note" title="Создать обращение" hint="Опишите проблему с заказом" to="/support" />
          <ActionRow icon="help" title="Частые вопросы" hint="Активация, коды и оплата" to="/guide" />
          {me && (
            <ActionRow
              icon="campaign"
              title="Наш канал"
              hint="Новые приложения и новости"
              onClick={() => openTelegramLink(me.channelUrl)}
            />
          )}
          {me?.termsUrl && (
            <ActionRow
              icon="description"
              title="Пользовательское соглашение"
              hint="Условия покупки и возврата"
              onClick={() => openExternalLink(me.termsUrl as string)}
            />
          )}
        </Menu>

        <p className="tabular text-center text-label-sm text-outline">{`AppDrop v${__APP_VERSION__}`}</p>
      </div>
    </Page>
  );
}
