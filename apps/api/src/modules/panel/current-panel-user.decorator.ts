import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { PanelRole, Permission } from '@pokatim/contracts';

/** Сотрудник запроса после `PanelGuard`: из сессии панели, не из тела или пути. */
export interface PanelPrincipal {
  userId: string;
  sessionId: string;
  role: PanelRole;
  permissions: readonly Permission[];
}

/** Запрос панели: поле `panel` (у `AuthGuard` приложения — `auth`, не пересекаются). */
export interface PanelRequest {
  panel?: PanelPrincipal;
}

/** Сотрудник, проверенный `PanelGuard`. Без гарда — ошибка программиста (500), а не анонимный доступ. */
export const CurrentPanelUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext) => {
    const panel = context.switchToHttp().getRequest<PanelRequest>().panel;
    if (!panel) throw new Error('CurrentPanelUser без PanelGuard');
    return panel satisfies PanelPrincipal;
  },
);
