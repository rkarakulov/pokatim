import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@pokatim/contracts';

export const PANEL_PERMISSION = 'panel:permission';

/** Право панели на обработчике (или контроллере): нет у роли — `403 FORBIDDEN` от `PanelGuard`. */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(PANEL_PERMISSION, permission);
