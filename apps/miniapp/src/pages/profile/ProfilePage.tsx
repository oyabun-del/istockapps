import { isPaidStatus } from '@istock/shared';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { Icon } from '../../components/ui/Icon';
import { api } from '../../lib/api';
import { queryKeys, useMe } from '../../lib/queries';
import { getTelegramProfile, openTelegramLink } from '../../lib/telegram';

type ActionProps = {
  icon: string;
  title: string;
  hint: string;
  onClick?: () => void;
  to?: string;
};

function ActionRow({ icon, title, hint, onClick, to }: ActionProps) {
  const content = (
    <>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-container-high text-primary">
        <Icon name={icon} className="text-[22px]" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="text-label-lg text-on-surface">{title}</span>
        <span className="truncate text-body-sm text-on-surface-variant">{hint}</span>
      </span>
      <Icon name="chevron_right" className="text-[20px] text-outline" />
    </>
  );
  const classes =
    'flex w-full items-center gap-3 rounded-xl bg-surface-container p-3.5 transition-all hover:bg-surface-container-high active:scale-[0.99]';

  if (to) {
    return (
      <Link to={to} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
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
      <section className="flex items-center gap-space-lg rounded-xl bg-surface-container-high p-space-lg">
        {photoUrl ? (
          <img src={photoUrl} alt="" width={64} height={64} className="h-16 w-16 rounded-full object-cover" />
        ) : (
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-container text-headline-lg text-white">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate text-headline-md text-on-surface">{name}</h1>
          {username && <span className="text-body-sm text-on-surface-variant">@{username}</span>}
          <p className="tabular mt-1 text-body-sm text-on-surface-variant">
            Покупок: <span className="font-semibold text-on-surface">{purchased}</span>, активировано:{' '}
            <span className="font-semibold text-secondary">{activated}</span>
          </p>
        </div>
      </section>

      <nav aria-label="Действия профиля" className="mt-space-lg flex flex-col gap-space-sm">
        <ActionRow icon="download_for_offline" title="Мои загрузки" hint="Заказы, логины и коды" to="/orders" />
        <ActionRow icon="edit_note" title="Создать обращение" hint="Ответим в Telegram" to="/support" />
        {me && (
          <>
            <ActionRow
              icon="support_agent"
              title="Поддержка"
              hint="Написать в Telegram"
              onClick={() => openTelegramLink(me.supportUrl)}
            />
            <ActionRow
              icon="campaign"
              title="Наш канал"
              hint="Новые приложения и новости"
              onClick={() => openTelegramLink(me.channelUrl)}
            />
          </>
        )}
      </nav>
    </Page>
  );
}
