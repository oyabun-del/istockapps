type Props = {
  name: string;
  className?: string;
  isFilled?: boolean;
};

/** Material Symbols Outlined glyph; decorative by default. */
export function Icon({ name, className = '', isFilled = false }: Props) {
  return (
    <span aria-hidden="true" className={`material-symbols-outlined ${isFilled ? 'icon-filled' : ''} ${className}`}>
      {name}
    </span>
  );
}
