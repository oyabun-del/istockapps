import { isTerminalStatus, type OrderDto } from '@istock/shared';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Link, useSearchParams } from 'react-router-dom';
import { Page } from '../../components/layout/Page';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/StateViews';
import { api, errorMessage } from '../../lib/api';
import { EASE_OUT_EXPO, HIGHLIGHT_SPRING } from '../../lib/motion';
import { queryKeys } from '../../lib/queries';
import { hapticImpact } from '../../lib/telegram';
import { OrderCard } from './OrderCard';

type TabId = 'all' | 'active' | 'archive';

type Tab = {
  id: TabId;
  label: string;
  matches: (order: OrderDto) => boolean;
  empty: { title: string; text: string };
};

const NO_ORDERS = { title: 'Покупок пока нет', text: 'Выберите приложение в каталоге. После оплаты оно появится здесь.' };

const TABS: readonly Tab[] = [
  { id: 'all', label: 'Все', matches: () => true, empty: NO_ORDERS },
  {
    id: 'active',
    label: 'Активные',
    matches: (order) => !isTerminalStatus(order.status),
    empty: { title: 'Активных заказов нет', text: 'Здесь будут заказы, которые ждут оплаты или активации.' },
  },
  {
    id: 'archive',
    label: 'Архив',
    matches: (order) => isTerminalStatus(order.status),
    empty: { title: 'Архив пуст', text: 'Сюда попадают активированные и закрытые заказы.' },
  },
];

const SKELETON_CARDS = 3;
const CARD_TRANSITION = { duration: 0.2, ease: EASE_OUT_EXPO };

function resolveTab(value: string | null): Tab {
  return TABS.find((tab) => tab.id === value) ?? (TABS[0] as Tab);
}

function TabBar({ active, orders, onSelect }: { active: TabId; orders: OrderDto[]; onSelect: (id: TabId) => void }) {
  return (
    <div role="tablist" aria-label="Фильтр заказов" className="grid grid-cols-3 gap-1 rounded-full bg-surface-container-lowest p-1">
      {TABS.map((tab) => {
        const isActive = tab.id === active;
        const count = orders.filter(tab.matches).length;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => {
              hapticImpact('light');
              onSelect(tab.id);
            }}
            className={`relative h-9 rounded-full text-label-lg transition-colors ${
              isActive ? 'text-on-surface' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            {isActive && (
              <motion.span
                layoutId="downloads-tab"
                transition={HIGHLIGHT_SPRING}
                className="absolute inset-0 rounded-full bg-surface-container-high shadow-sm"
              />
            )}
            <span className="tabular relative">{`${tab.label} (${count})`}</span>
          </button>
        );
      })}
    </div>
  );
}

export function DownloadsPage() {
  const orders = useQuery({ queryKey: queryKeys.orders, queryFn: api.orders });
  const [params, setParams] = useSearchParams();
  const tab = resolveTab(params.get('tab'));
  const all = orders.data ?? [];
  const visible = all.filter(tab.matches);

  const selectTab = (id: TabId) => setParams(id === 'all' ? {} : { tab: id }, { replace: true });

  return (
    <Page subtitle="Мои загрузки">
      <h1 className="mt-space-xs text-headline-lg tracking-tight text-on-surface">Мои загрузки</h1>
      <p className="mb-space-lg mt-1 text-body-sm text-on-surface-variant">Заказы, логины и коды для активации</p>

      {orders.isPending && (
        <div className="flex flex-col gap-space-md">
          {Array.from({ length: SKELETON_CARDS }, (_, index) => (
            <Skeleton key={index} className="h-[148px]" />
          ))}
        </div>
      )}
      {orders.isError && <ErrorState message={errorMessage(orders.error)} onRetry={() => void orders.refetch()} />}

      {orders.data && all.length === 0 && (
        <EmptyState
          icon="download_for_offline"
          title={NO_ORDERS.title}
          text={NO_ORDERS.text}
          action={
            <Link to="/" className="text-label-lg text-primary">
              Перейти в каталог
            </Link>
          }
        />
      )}

      {all.length > 0 && (
        <div className="flex flex-col gap-space-md">
          <TabBar active={tab.id} orders={all} onSelect={selectTab} />
          {visible.length === 0 && <EmptyState icon="download_for_offline" title={tab.empty.title} text={tab.empty.text} />}
          <AnimatePresence mode="popLayout" initial={false}>
            {visible.map((order) => (
              <motion.div
                key={order.id}
                layout="position"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={CARD_TRANSITION}
              >
                <OrderCard order={order} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </Page>
  );
}
