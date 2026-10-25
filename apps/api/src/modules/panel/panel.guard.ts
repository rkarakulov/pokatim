import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@pokatim/contracts';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';

import { domainError } from '../../error-messages';
import { sha256 } from '../identity';
import type { PanelRequest } from './current-panel-user.decorator';
import { PANEL_POLICY } from './panel.policy';
import { PanelRepository } from './panel.repository';
import { PanelSessionCheck } from './panel-session-check';
import { PanelSessionCookie } from './panel-session-cookie';
import { permissionsOf } from './permissions';
import { PANEL_PUBLIC } from './public.decorator';
import { PANEL_PERMISSION } from './require-permission.decorator';

/**
 * Авторизация каждого запроса API панели (ADR-0009, R1). Цепочка: cookie панели → живая сессия (не отозвана, не
 * истекла по простою и абсолютному сроку) → аккаунт приложения активен (не удалён, подтверждён) и штамп учётных данных
 * совпадает с записанным при входе → член команды `active` → права роли (карта — только здесь, на сервере).
 * Access JWT и refresh приложения не принимаются. Любой отказ — один `401 UNAUTHORIZED` (+ сброс предъявленной
 * cookie); нет права из `@RequirePermission` — `403 FORBIDDEN`. Ставит `Cache-Control: no-store` на все ответы.
 */
@Injectable()
export class PanelGuard implements CanActivate {
  private readonly logger = new Logger('PanelGuard');

  constructor(
    private readonly reflector: Reflector,
    private readonly repository: PanelRepository,
    private readonly check: PanelSessionCheck,
    private readonly cookie: PanelSessionCookie,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<PanelRequest>();
    const reply = http.getResponse<unknown>();
    this.cookie.noStore(reply);
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PANEL_PUBLIC, targets)) return true;

    const { token, presented } = this.cookie.read(request);
    const deny = () => {
      if (presented) this.cookie.clear(reply);
      return domainError('UNAUTHORIZED', 401);
    };
    if (!token) throw deny();

    const now = this.clock.now();
    const session = await this.repository.findLiveSession(sha256(token), now);
    if (!session) throw deny();

    const verdict = await this.check.verdict(session);
    if (!verdict.valid) {
      await this.repository.revokeSession({ id: session._id }, now, verdict.reason);
      this.logger.log(`сессия панели отозвана sid=${session._id} reason=${verdict.reason}`);
      throw deny();
    }
    const { member } = verdict;

    const permissions = permissionsOf(member.role);
    request.panel = {
      userId: session.userId,
      sessionId: session._id,
      role: member.role,
      permissions,
    };
    await this.repository.touchSession(
      session._id,
      now,
      PANEL_POLICY.sessionIdleMs,
      PANEL_POLICY.touchIntervalMs,
    );

    const required = this.reflector.getAllAndOverride<Permission | undefined>(
      PANEL_PERMISSION,
      targets,
    );
    if (required && !permissions.includes(required)) throw domainError('FORBIDDEN', 403);
    return true;
  }
}
