import { createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { AuthUser } from './access-token';
import type { AuthenticatedRequest } from './auth.guard';

/**
 * Пользователь запроса, проверенный `AuthGuard`. Без гарда на обработчике — ошибка программиста (500), а не
 * анонимный доступ.
 */
export const CurrentUser = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new Error('CurrentUser без AuthGuard');
  return auth satisfies AuthUser;
});
