import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { showBackButton } from '../lib/telegram';

/**
 * Shows Telegram's native back button; navigates to `fallback` on the screen the Mini App opened
 * with. The router marks that first entry with the key 'default' (history.length is unreliable
 * in Telegram's webview).
 */
export function useBackButton(fallback = '/'): void {
  const navigate = useNavigate();
  const isFirstEntry = useLocation().key === 'default';

  useEffect(() => {
    const goBack = () => {
      if (isFirstEntry) navigate(fallback, { replace: true });
      else navigate(-1);
    };
    return showBackButton(goBack);
  }, [navigate, fallback, isFirstEntry]);
}
