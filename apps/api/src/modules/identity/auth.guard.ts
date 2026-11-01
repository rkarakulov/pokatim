import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { AccessTokenVerifier, type AuthUser, parseBearer } from './access-token';
import { ActiveDay } from './active-day';
import { IdentityRepository } from './identity.repository';

/** Запрос после `AuthGuard`: пользователь — только из проверенного access. */
export interface AuthenticatedRequest {
  headers: Record<string, unknown>;
  auth?: AuthUser;
}

/**
 * Авторизация запроса (ADR-0008, R1): `Authorization: Bearer <jwt>` → `AccessTokenVerifier` → сессия `sid`
 * принадлежит `sub`, не отозвана, не истекла, пользователь не удалён. Выход, сброс пароля и reuse detection
 * действуют сразу, а не через срок access. Любой отказ — один и тот же `401 UNAUTHORIZED`, без лога (истечение
 * access — норма). Результат — `request.auth`, читается `@CurrentUser()`. Затем — отметка активного дня (K12, P7,
 * `ActiveDay`: не бросает, ждёт ≤ 200 мс); панель и публичные ручки этот гард не проходят.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly verifier: AccessTokenVerifier,
    private readonly repository: IdentityRepository,
    private readonly activeDay: ActiveDay,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = parseBearer(request.headers.authorization);
    const now = this.clock.now();
    const auth = token ? await this.verifier.verify(token, now) : undefined;
    if (!auth || !(await this.repository.findActiveSession(auth.sessionId, auth.userId, now))) {
      throw domainError('UNAUTHORIZED', 401);
    }
    request.auth = auth;
    await this.activeDay.touch(auth.userId, now);
    return true;
  }
}
