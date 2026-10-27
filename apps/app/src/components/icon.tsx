import type { IconWeight } from '@pokatim/design-tokens';
import { SymbolView, type AndroidSymbol, type SFSymbol, type SymbolViewProps } from 'expo-symbols';

import { useAppTheme } from '@/theme/use-app-theme';

/** Иконки приложения: SF Symbol (iOS, с заливочным вариантом) и Material Symbol (Android, web). */
const ICONS = {
  watch: { ios: 'applewatch', material: 'watch' },
  profile: {
    ios: 'person.crop.circle',
    iosFilled: 'person.crop.circle.fill',
    material: 'account_circle',
  },
  person: { ios: 'person', iosFilled: 'person.fill', material: 'person' },
  zoomIn: { ios: 'plus', material: 'add' },
  zoomOut: { ios: 'minus', material: 'remove' },
  fit: { ios: 'arrow.up.left.and.arrow.down.right', material: 'fit_screen' },
  locate: { ios: 'location', iosFilled: 'location.fill', material: 'my_location' },
} as const satisfies Record<
  string,
  { ios: SFSymbol; iosFilled?: SFSymbol; material: AndroidSymbol }
>;

export type IconName = keyof typeof ICONS;

type AndroidWeight = Extract<NonNullable<SymbolViewProps['weight']>, object>['android'];

/**
 * Файлы шрифта Material Symbols по весу для Android/web (`expo-symbols/androidWeights/<вес>`, ~сотни КБ каждый).
 * Импортируются только веса, реально используемые в `appThemes`; в B у всех тем `regular` — пусто. Вес без файла —
 * как `regular` (на iOS тоже: вес одинаков на всех платформах).
 */
const WEIGHT_FONTS: Partial<Record<Exclude<IconWeight, 'regular'>, AndroidWeight>> = {};

export interface IconProps {
  name: IconName;
  size: number;
  color: string;
  /** заливочный вариант (только iOS: статичные Material Symbols заливки не умеют); по умолчанию — из темы */
  filled?: boolean;
  testID?: string;
}

/**
 * Единственный вход `expo-symbols` в приложении (ADR-0016): вес и заливка — из темы. `key` по весу: `SymbolView`
 * загружает шрифт Android/web один раз при монтировании — новый вес требует нового экземпляра.
 */
export function Icon({ name, size, color, filled, testID }: IconProps) {
  const { icons } = useAppTheme();
  const icon: { ios: SFSymbol; iosFilled?: SFSymbol; material: AndroidSymbol } = ICONS[name];
  const ios = (filled ?? icons.filled) ? (icon.iosFilled ?? icon.ios) : icon.ios;
  const android = icons.weight === 'regular' ? undefined : WEIGHT_FONTS[icons.weight];
  return (
    <SymbolView
      key={android ? icons.weight : 'regular'}
      name={{ ios, android: icon.material, web: icon.material }}
      size={size}
      tintColor={color}
      testID={testID}
      {...(android ? { weight: { ios: icons.weight, android } } : {})}
    />
  );
}
