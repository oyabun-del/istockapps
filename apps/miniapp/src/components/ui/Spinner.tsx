type Props = {
  className?: string;
};

export function Spinner({ className = 'h-6 w-6' }: Props) {
  return (
    <span
      role="status"
      aria-label="Загрузка"
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${className}`}
    />
  );
}
