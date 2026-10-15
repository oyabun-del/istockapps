import { Icon } from './Icon';

type Props = {
  path: readonly string[];
};

const INDENT_PX = 12;

/** iOS Settings breadcrumb: "Настройки → Ваше имя → …", one level per line. */
export function SettingsPath({ path }: Props) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-space-sm text-code-sm text-on-surface-variant">
      {path.map((item, index) => (
        <span key={item} className="flex items-center gap-space-xs" style={{ paddingLeft: `${index * INDENT_PX}px` }}>
          <Icon
            name={index === 0 ? 'settings' : 'subdirectory_arrow_right'}
            className={`text-[14px] ${index === 0 ? 'text-primary' : 'text-outline'}`}
          />
          <span className={index === path.length - 1 ? 'font-semibold text-on-surface' : ''}>{item}</span>
        </span>
      ))}
    </div>
  );
}
