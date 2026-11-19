import { Fragment } from 'react';
import { Icon } from './Icon';

type Props = {
  path: readonly string[];
};

/**
 * iOS Settings breadcrumb on one line: "Настройки › Ваше имя › …". An item never breaks inside;
 * on a narrow screen the line wraps only between items.
 */
export function SettingsPath({ path }: Props) {
  return (
    <p className="flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-lg bg-surface-container-low px-space-sm py-1.5 text-code-sm text-on-surface-variant">
      <Icon name="settings" className="text-[14px] text-primary" />
      {path.map((item, index) => (
        <Fragment key={item}>
          {index > 0 && (
            <span aria-hidden="true" className="text-outline">
              ›
            </span>
          )}
          <span className={`whitespace-nowrap ${index === path.length - 1 ? 'font-semibold text-on-surface' : ''}`}>{item}</span>
        </Fragment>
      ))}
    </p>
  );
}
