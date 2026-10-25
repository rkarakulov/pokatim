import { Inject, Injectable } from '@nestjs/common';
import { Uuid } from '@pokatim/contracts';
import { ENV } from '@rkarakulov/api-kit/core';
import { jwtVerify } from 'jose';

import type { Env } from '../../config/env';
import { JWT_AUDIENCE, JWT_ISSUER } from './identity.policy';

/** Пользователь запроса под `AuthGuard`: только из проверенного access, не из тела или пути. */
export interface AuthUser {
  userId: string;
  sessionId: string;
}

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const MAX_HEADER_LENGTH = 2048;

/** JWT из заголовка `Authorization: Bearer <jwt>`; другой формат и длина больше предела — `undefined` до jose. */
export function parseBearer(header: unknown): string | undefined {
  if (typeof header !== 'string' || header.length > MAX_HEADER_LENGTH) return undefined;
  return BEARER.exec(header)?.[1];
}

/**
 * Единственная проверка access JWT (ADR-0008): HS256 только (`none`, RS/ES, HS512 отвергаются), `iss`/`aud`
 * проекта, `exp` — по переданному «сейчас» (`CLOCK`), обязательные `sub` и `sid` — UUID после zod (в фильтр БД
 * уходят только они). Живость сессии проверяет `AuthGuard`. Любой отказ — `undefined`, без причины.
 */
@Injectable()
export class AccessTokenVerifier {
  private readonly key: Uint8Array;

  constructor(@Inject(ENV) env: Pick<Env, 'JWT_SECRET'>) {
    this.key = new TextEncoder().encode(env.JWT_SECRET);
  }

  async verify(token: string, now: Date): Promise<AuthUser | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
        currentDate: now,
        requiredClaims: ['sub', 'sid', 'exp', 'iat'],
      });
      const userId = Uuid.safeParse(payload.sub);
      const sessionId = Uuid.safeParse(payload.sid);
      if (!userId.success || !sessionId.success) return undefined;
      return { userId: userId.data, sessionId: sessionId.data };
    } catch {
      return undefined;
    }
  }
}
