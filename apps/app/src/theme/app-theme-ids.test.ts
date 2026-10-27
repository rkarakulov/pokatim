/// <reference types="jest" />
import { APP_THEME_IDS, type AppThemeId as ContractThemeId } from '@pokatim/contracts';
import { appThemes, type AppThemeId as TokenThemeId } from '@pokatim/design-tokens';

// равенство типов в обе стороны: новая тема в контрактах без палитры (и наоборот) — ошибка typecheck
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const sameIds: Equal<ContractThemeId, TokenThemeId> = true;

describe('темы приложения: контракты и реестр токенов', () => {
  it('реестр appThemes — тот же состав и порядок, что APP_THEME_IDS', () => {
    expect(sameIds).toBe(true);
    expect(Object.keys(appThemes)).toEqual([...APP_THEME_IDS]);
  });
});
