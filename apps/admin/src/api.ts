import { createAdminApiClient } from '@pokatim/api-client';

// тот же origin: в dev и `vite preview` Vite проксирует /v1 на API, на стенде и в проде — /admin/ того же домена
export const api = createAdminApiClient({ baseUrl: '' });
