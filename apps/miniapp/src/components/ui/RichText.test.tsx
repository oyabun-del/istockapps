import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RichText } from './RichText';

const chips = (container: HTMLElement) => Array.from(container.querySelectorAll('strong')).map((chip) => chip.textContent);

describe('RichText', () => {
  it('renders plain text as is', () => {
    const { container } = render(<RichText text="Дождитесь окончания загрузки." />);

    expect(container).toHaveTextContent('Дождитесь окончания загрузки.');
    expect(chips(container)).toEqual([]);
  });

  it('shows a quoted button name as a chip and keeps the quotes in the text', () => {
    const { container } = render(<RichText text="Нажмите «Я скачал» в заказе." />);

    expect(screen.getByText('Я скачал', { selector: 'strong' })).toBeInTheDocument();
    expect(container.textContent).toBe('Нажмите «Я скачал» в заказе.');
  });

  it('highlights every quoted name in one sentence', () => {
    const { container } = render(<RichText text="Нажмите «Получить логин и пароль», затем «Включить ожидание кода»." />);

    expect(chips(container)).toEqual(['«Получить логин и пароль»', '«Включить ожидание кода»']);
  });

  it('leaves an unclosed quote as plain text', () => {
    const { container } = render(<RichText text="Нажмите «Скачать и подождите" />);

    expect(container.textContent).toBe('Нажмите «Скачать и подождите');
    expect(chips(container)).toEqual([]);
  });
});
