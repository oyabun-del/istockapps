import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Page } from '../../components/layout/Page';
import { ErrorState, EmptyState, Skeleton } from '../../components/ui/StateViews';
import { useDebounce } from '../../hooks/useDebounce';
import { api, errorMessage } from '../../lib/api';
import { EASE_OUT_EXPO, LIST_STAGGER_S } from '../../lib/motion';
import { queryKeys } from '../../lib/queries';
import { AppRow } from './AppRow';
import { CategoryChips } from './CategoryChips';
import { SearchBar } from './SearchBar';

const SEARCH_DEBOUNCE_MS = 300;
const ALL_CATEGORY = 'all';
const SKELETON_ROWS = 5;

function pluralizeApps(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return `${count} приложение`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} приложения`;
  return `${count} приложений`;
}

export function CatalogPage() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORY);
  const debouncedSearch = useDebounce(search.trim(), SEARCH_DEBOUNCE_MS);

  const query = { q: debouncedSearch || undefined, category: category === ALL_CATEGORY ? undefined : category };
  const categories = useQuery({ queryKey: queryKeys.categories, queryFn: api.categories, staleTime: Infinity });
  const apps = useQuery({ queryKey: queryKeys.apps(query), queryFn: () => api.apps(query), placeholderData: (prev) => prev });

  const resetFilters = () => {
    setSearch('');
    setCategory(ALL_CATEGORY);
  };

  return (
    <Page subtitle="Каталог">
      <div className="flex flex-col gap-space-sm">
        <SearchBar value={search} onChange={setSearch} />
        <CategoryChips categories={categories.data ?? []} activeId={category} onSelect={setCategory} />
      </div>

      <div className="mt-space-lg flex items-baseline justify-between">
        <h1 className="text-headline-md tracking-tight text-on-surface">Приложения</h1>
        {apps.data && <span className="text-label-md text-on-surface-variant">{pluralizeApps(apps.data.length)}</span>}
      </div>

      <section aria-label="Список приложений" aria-busy={apps.isFetching} className="mt-space-md flex flex-col gap-space-md">
        {apps.isPending &&
          Array.from({ length: SKELETON_ROWS }, (_, index) => <Skeleton key={index} className="h-[72px]" />)}

        {apps.isError && <ErrorState message={errorMessage(apps.error)} onRetry={() => void apps.refetch()} />}

        {apps.data?.length === 0 && (
          <EmptyState
            icon="search_off"
            title="Ничего не нашли"
            text="Попробуйте другой запрос или напишите в поддержку, и мы добавим нужное приложение."
            action={
              <button type="button" onClick={resetFilters} className="text-label-lg text-primary">
                Сбросить фильтры
              </button>
            }
          />
        )}

        <AnimatePresence initial mode="popLayout">
          {apps.data?.map((app, index) => (
            <motion.div
              key={app.id}
              layout="position"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0, transition: { duration: 0.42, ease: EASE_OUT_EXPO, delay: index * LIST_STAGGER_S } }}
              exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}
            >
              <AppRow app={app} />
            </motion.div>
          ))}
        </AnimatePresence>
      </section>
    </Page>
  );
}
