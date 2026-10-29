import { queryOptions } from '@tanstack/react-query';

import { api } from '../../api';

/** «Обзор» (admin-overview): блоки по правам сотрудника — решает сервер. */
export const overviewQuery = () =>
  queryOptions({ queryKey: ['admin', 'overview'], queryFn: () => api.overview() });
