import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../../lib/api';
import { ME, SELLER, renderWithProviders } from '../../test/render';
import { LegalPage } from './LegalPage';

function renderDoc(doc: string, me = ME) {
  vi.spyOn(api, 'me').mockResolvedValue(me);
  return renderWithProviders(<LegalPage />, { route: `/legal/${doc}`, path: '/legal/:doc' });
}

describe('LegalPage', () => {
  it('shows the terms with the seller contacts', async () => {
    renderDoc('terms');

    expect(await screen.findByRole('heading', { level: 1, name: 'Пользовательское соглашение' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Возврат денег/ })).toBeInTheDocument();
    const details = await screen.findByRole('region', { name: 'Контакты' });
    expect(details).toHaveTextContent(SELLER.name);
    expect(screen.getAllByRole('link', { name: SELLER.email })[0]).toHaveAttribute('href', `mailto:${SELLER.email}`);
    expect(screen.getByRole('link', { name: /Политика конфиденциальности/ })).toHaveAttribute('href', '/legal/privacy');
  });

  it('shows the privacy policy: what is stored and who receives it', async () => {
    renderDoc('privacy');

    expect(await screen.findByRole('heading', { level: 1, name: 'Политика конфиденциальности' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent(/идентификатор Telegram/);
    expect(screen.getByRole('main')).toHaveTextContent(/Platega/);
    expect(screen.getByRole('main')).toHaveTextContent(/Install-IOS/);
    expect(screen.getByRole('main')).toHaveTextContent(/не хранит/);
    expect(screen.getByRole('link', { name: /Пользовательское соглашение/ })).toHaveAttribute('href', '/legal/terms');
  });

  it.each(['terms', 'privacy'])('names no legal form or registration numbers in %s', async (doc) => {
    renderDoc(doc);

    await screen.findByRole('region', { name: 'Контакты' });
    expect(screen.getByRole('main')).not.toHaveTextContent(/(^|[^А-Яа-я])ИП([^А-Яа-я]|$)|ИНН|ОГРН|ООО|физическ/i);
  });

  it.each(['terms', 'privacy'])('does not mention a channel subscription in %s', async (doc) => {
    renderDoc(doc);

    await screen.findByRole('region', { name: 'Контакты' });
    expect(screen.getByRole('main')).not.toHaveTextContent(/подписк|подписан|на канал/i);
  });

  it('names no legal form when the contacts are not configured', async () => {
    renderDoc('terms', { ...ME, seller: null });

    expect(await screen.findByText('Контакты пока не указаны')).toBeInTheDocument();
    expect(screen.getByRole('main')).not.toHaveTextContent(/(^|[^А-Яа-я])ИП([^А-Яа-я]|$)/);
  });

  it('sends unknown documents to the catalog', () => {
    renderDoc('cookies');

    expect(screen.getByTestId('navigated')).toBeInTheDocument();
  });
});
