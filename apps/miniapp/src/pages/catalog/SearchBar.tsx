import { Icon } from '../../components/ui/Icon';

type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function SearchBar({ value, onChange }: Props) {
  return (
    <div className="relative flex w-full items-center">
      <Icon name="search" className="pointer-events-none absolute left-4 text-[20px] text-outline" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Поиск удалённых приложений и игр…"
        aria-label="Поиск приложений"
        enterKeyHint="search"
        className="h-11 w-full rounded-full bg-surface-container-high pl-11 pr-10 text-body-md text-on-surface shadow-sm transition-all placeholder:text-outline focus:bg-surface-container-highest focus:outline-none focus:ring-2 focus:ring-primary-container/60 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Очистить поиск"
          className="absolute right-2 flex h-8 w-8 items-center justify-center rounded-full text-outline hover:text-on-surface"
        >
          <Icon name="cancel" className="text-[18px]" />
        </button>
      )}
    </div>
  );
}
