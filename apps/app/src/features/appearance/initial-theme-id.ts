import type { AppThemeId } from '@pokatim/contracts';

/** native: до чтения кэша тема неизвестна (`null` — корень держит сплэш). Web — `.web.ts`. */
export function initialThemeId(): AppThemeId | null {
  return null;
}
