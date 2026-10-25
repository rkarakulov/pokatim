/**
 * Текст ошибки `db:migrate`. Ошибка драйвера MongoDB (числовой `code`) — только имя, код и `codeName`: в `message`
 * и `keyValue` дубликата — значения ключа (персональные данные). Собственные ошибки мигратора и env — полностью:
 * в них нет значений данных и адреса БД.
 */
export function describeMigrateError(error: unknown): string {
  if (!(error instanceof Error)) return typeof error;
  const { code, codeName } = error as { code?: unknown; codeName?: unknown };
  if (typeof code !== 'number') return error.message;
  const parts = [`code ${code}`, typeof codeName === 'string' ? codeName : undefined];
  return `${error.name} (${parts.filter(Boolean).join(', ')})`;
}
