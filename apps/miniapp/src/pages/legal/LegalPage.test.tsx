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
  it('shows the terms with the seller details', async () => {
    renderDoc('terms');

    expect(await screen.findByRole('heading', { level: 1, name: 'Пользовательское соглашение' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Возврат денег/ })).toBeInTheDocument();
    const details = await screen.findByRole('region', { name: 'Реквизиты продавца' });
    expect(details).toHaveTextContent(SELLER.name);
    expect(details).toHaveTextContent(`ИНН ${SELLER.inn}`);
    expect(details).toHaveTextContent(`ОГРНИП ${SELLER.ogrnip}`);
    expect(screen.getAllByRole('link', { name: SELLER.email })[0]).toHaveAttribute('href', `mailto:${SELLER.email}`);
    expect(screen.getByRole('link', { name: /Политика конфиденциальности/ })).toHaveAttribute('href', '/legal/privacy');
  });

  it('shows the privacy policy: what is stored and who receives it', async () => {
    renderDoc('privacy');

    expect(await screen.findByRole('heading', { level: 1, name: 'Политика конфиденциальности' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveTextContent(/идентификатор Telegram/);
    expect(screen.getByRole('main')).toHaveTextContent(/CISPAY/);
    expect(screen.getByRole('main')).toHaveTextContent(/Install-IOS/);
    expect(screen.getByRole('main')).toHaveTextContent(/не хранит/);
    expect(screen.getByRole('link', { name: /Пользовательское соглашение/ })).toHaveAttribute('href', '/legal/terms');
  });

  it('says the details are missing instead of showing blanks', async () => {
    renderDoc('terms', { ...ME, seller: null });

    expect(await screen.findByText('Реквизиты продавца пока не указаны')).toBeInTheDocument();
  });

  it('sends unknown documents to the catalog', () => {
    renderDoc('cookies');

    expect(screen.getByTestId('navigated')).toBeInTheDocument();
  });
});
