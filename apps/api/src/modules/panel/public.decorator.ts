import { SetMetadata } from '@nestjs/common';

export const PANEL_PUBLIC = 'panel:public';

/**
 * Маршрут панели без сессии (вход, выход): `PanelGuard` пропускает его, ставя только `no-store`. Список таких
 * маршрутов проверяет тест `panel-routes.test.ts`.
 */
export const Public = () => SetMetadata(PANEL_PUBLIC, true);
