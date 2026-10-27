import { useEffect, useRef } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ErrorState, FullScreenLoader } from './components/ui/StateViews';
import { errorMessage } from './lib/api';
import { useMe } from './lib/queries';
import { getStartParam } from './lib/telegram';
import { AppPage } from './pages/app/AppPage';
import { CatalogPage } from './pages/catalog/CatalogPage';
import { DownloadsPage } from './pages/downloads/DownloadsPage';
import { SubscriptionGate } from './pages/gate/SubscriptionGate';
import { GuidePage } from './pages/guide/GuidePage';
import { OrderPage } from './pages/order/OrderPage';
import { ProfilePage } from './pages/profile/ProfilePage';

/** Opens `/orders/:id` when the Mini App was launched with ?startapp=<orderId>. */
function StartParamRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHandled = useRef(false);

  useEffect(() => {
    if (isHandled.current) return;
    isHandled.current = true;
    const startParam = getStartParam();
    if (startParam && /^\d+$/.test(startParam) && location.pathname === '/') {
      navigate(`/orders/${startParam}`);
    }
  }, [navigate, location.pathname]);

  return null;
}

export function AppRoutes() {
  return (
    <>
      <StartParamRedirect />
      <Routes>
        <Route path="/" element={<CatalogPage />} />
        <Route path="/apps/:appId" element={<AppPage />} />
        <Route path="/orders" element={<DownloadsPage />} />
        <Route path="/orders/:orderId" element={<OrderPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export function App() {
  const me = useMe();

  if (me.isPending) return <FullScreenLoader />;
  if (me.isError) {
    return (
      <main className="mx-auto flex min-h-[100dvh] max-w-xl flex-col justify-center px-margin">
        <ErrorState message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
      </main>
    );
  }
  if (!me.data.isSubscribed) return <SubscriptionGate me={me.data} />;
  return <AppRoutes />;
}
