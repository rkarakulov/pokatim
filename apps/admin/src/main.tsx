import './fonts';
import './index.css';

import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { installDesignSystem } from './design-system';
import { createAppRouter } from './router';
import { expiredRedirect } from './session/expired';
import { createQueryClient } from './session/query-client';

installDesignSystem();

const queryClient = createQueryClient({ onUnauthorized: () => expiredRedirect(router) });
const router = createAppRouter({ queryClient });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
