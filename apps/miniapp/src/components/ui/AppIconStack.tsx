import type { OrderItemDto } from '@istock/shared';
import { AppIcon } from './AppIcon';

const MAX_VISIBLE = 3;

type Props = {
  items: readonly OrderItemDto[];
};

/** One app shows its icon; several apps overlap up to three icons in the same 56px slot. */
export function AppIconStack({ items }: Props) {
  const [first] = items;
  if (items.length <= 1) return <AppIcon src={first?.iconUrl ?? ''} size="md" />;

  const visible = items.slice(0, MAX_VISIBLE);
  return (
    <span className="relative h-14 w-14 shrink-0" aria-hidden="true">
      {visible.map((item, index) => (
        <span
          key={item.id}
          className="absolute rounded-xl ring-2 ring-surface-container"
          style={{ left: index * 6, top: index * 6, zIndex: MAX_VISIBLE - index }}
        >
          <AppIcon src={item.iconUrl} />
        </span>
      ))}
    </span>
  );
}
