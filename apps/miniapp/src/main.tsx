import { QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { createQueryClient } from './lib/queries';
import { ROUTER_FUTURE } from './lib/router';
import { initTelegram } from './lib/telegram';
import './index.css';

initTelegram();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={createQueryClient()}>
      {/* Hash routing: works on any static host and with bot deep links (#/orders/15). */}
      <HashRouter future={ROUTER_FUTURE}>
        <MotionConfig reducedMotion="user">
          <App />
        </MotionConfig>
      </HashRouter>
    </QueryClientProvider>
  </StrictMode>,
);
