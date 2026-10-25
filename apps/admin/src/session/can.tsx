import type { Permission } from '@pokatim/contracts';
import type { ReactNode } from 'react';

import { useMe } from './me';

/**
 * Право текущего сотрудника — только для отображения (скрыть недоступное). Источник истины — сервер: `PanelGuard`
 * проверяет право на каждом запросе.
 */
export function useCan(permission: Permission): boolean {
  return useMe()?.permissions.includes(permission) ?? false;
}

/** Показывает детей при праве, иначе `fallback` (по умолчанию — ничего). */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}): ReactNode {
  return useCan(permission) ? children : fallback;
}
