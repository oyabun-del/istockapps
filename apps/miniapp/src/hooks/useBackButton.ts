import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { showBackButton } from '../lib/telegram';

/** Shows Telegram's native back button; navigates to `fallback` when there is no history. */
export function useBackButton(fallback = '/'): void {
  const navigate = useNavigate();

  useEffect(() => {
    const goBack = () => {
      if (window.history.length > 1) navigate(-1);
      else navigate(fallback, { replace: true });
    };
    return showBackButton(goBack);
  }, [navigate, fallback]);
}
