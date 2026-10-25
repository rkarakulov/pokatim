/// <reference types="jest" />

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

export const USER_A = '0199a000-0000-7000-8000-00000000000a';
export const USER_B = '0199b000-0000-7000-8000-00000000000b';
export const SID_A = '0199a000-0000-7000-8000-0000000000a1';
export const SID_B = '0199b000-0000-7000-8000-0000000000b1';

/**
 * Access JWT для тестов приложения: настоящий формат (header.payload.signature), подпись — метка. Приложение подпись не
 * проверяет (это делает сервер), из payload читает только `sub`/`sid` (чья сессия) и `iat`/`exp` (срок жизни).
 */
export function fakeAccessToken(
  claims: { sub?: string; sid?: string; iat?: number; exp?: number } = {},
  tag = 'sig',
): string {
  const iat = claims.iat ?? Math.floor(Date.parse('2026-10-22T10:00:00Z') / 1000);
  const payload = {
    sub: claims.sub ?? USER_A,
    sid: claims.sid ?? SID_A,
    iat,
    exp: claims.exp ?? iat + 15 * 60,
  };
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.${tag}`;
}
