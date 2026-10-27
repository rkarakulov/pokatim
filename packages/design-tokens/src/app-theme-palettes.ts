import { radius, type ShapeRoles } from '@rkarakulov/design-tokens';

import type { AppTheme, Basemap } from './brand.ts';

/**
 * Палитры шести тем приложения (ADR-0016, слайс C): только внутри design-tokens, из `index.ts` не экспортируются —
 * приложения читают роли схем через реестр `appThemes`. Значения — интерпретация референса тем с проверенным
 * контрастом (`contrastPairsOf`); правки — только здесь.
 */

type Hex = string;

/** Явные значения схемы; порядок внутри кортежа — порядок ключей группы ролей. */
interface Palette {
  basemap: Basemap;
  /** primary / secondary / accent / disabled */
  text: [Hex, Hex, Hex, Hex];
  /** default / raised / disabled / skeleton */
  surface: [Hex, Hex, Hex, Hex];
  /** subtle / strong / input / focus / sheet */
  border: [Hex, Hex, Hex, Hex, Hex];
  /** primary / onPrimary */
  action: [Hex, Hex];
  /** success / warning / error / onError / errorTint */
  status: [Hex, Hex, Hex, Hex, Hex];
  /** background / line / route / corridor / track / offCorridor */
  map: [Hex, Hex, Hex, Hex, Hex, Hex];
  /** line / fillTop */
  profile: [Hex, Hex];
  /** trackOn / thumbOn */
  control: [Hex, Hex];
  /** background / active */
  tabBar: [Hex, Hex];
}

const WHITE = '#FFFFFF';
const BLACK = '#000000';

/** Схема из палитры: явные значения + структурные правила, одинаковые для всех тем. */
function appScheme(p: Palette, shape: ShapeRoles): AppTheme {
  const [primary, secondary, accent, disabled] = p.text;
  const [surfaceDefault, raised, surfaceDisabled, skeleton] = p.surface;
  const [subtle, strong, input, focus, sheet] = p.border;
  const [actionPrimary, onPrimary] = p.action;
  const [success, warning, error, onError, errorTint] = p.status;
  const [background, line, route, corridor, track, offCorridor] = p.map;
  const [profileLine, fillTop] = p.profile;
  const [trackOn, thumbOn] = p.control;
  const [tabBackground, tabActive] = p.tabBar;
  return {
    text: {
      primary,
      secondary,
      accent,
      onPrimary,
      onPhoto: WHITE,
      placeholder: secondary,
      disabled,
    },
    surface: {
      default: surfaceDefault,
      raised,
      sheet: raised,
      disabled: surfaceDisabled,
      skeleton,
    },
    border: { subtle, strong, input, focus, sheet },
    action: { primary: actionPrimary, onPrimary },
    status: { success, warning, error, onError, errorTint },
    map: { basemap: p.basemap, background, line, route, corridor, track, offCorridor },
    surfaceBar: { asphalt: primary, gravel: subtle, gravelHatch: primary, outline: secondary },
    profile: { line: profileLine, fillTop, fillBottom: fillTop, grid: subtle },
    overlay: { scrim: BLACK },
    control: { track: input, trackOn, thumb: WHITE, thumbOn },
    tabBar: { background: tabBackground, active: tabActive, inactive: secondary },
    shape,
  };
}

/** Форма темы: радиусы button / field / chip / card / sheet (px) и регистр подписи кнопки. */
const shape = (
  [button, field, chip, card, sheet]: [number, number, number, number, number],
  buttonCase: ShapeRoles['buttonCase'] = 'none',
): ShapeRoles => ({ button, field, chip, card, sheet, buttonCase });

/** Атлас: светло-серый экран, белые карточки, оранжевый акцент карты и профиля, чёрная кнопка. */
const atlasShape = shape([14, 12, radius.pill, 16, 24]);
export const atlas = {
  light: appScheme(
    {
      basemap: 'light',
      text: ['#15171A', '#5B616B', '#C2410C', '#8E939B'],
      surface: ['#F2F3F5', '#FFFFFF', '#E3E5E8', '#E3E5E8'],
      border: ['#E3E5E8', '#CDD1D6', '#7D838C', '#15171A', '#E3E5E8'],
      action: ['#15171A', '#FFFFFF'],
      status: ['#1E7A46', '#866C00', '#B0103A', '#FFFFFF', '#FBEDEB'],
      map: ['#EEF0F2', '#DADDE1', '#D9480F', '#5B616B', '#1D6FD8', '#B0103A'],
      profile: ['#D9480F', '#F76707'],
      control: ['#15171A', '#FFFFFF'],
      tabBar: ['#FFFFFF', '#15171A'],
    },
    atlasShape,
  ),
  dark: appScheme(
    {
      basemap: 'dark',
      text: ['#F1F2F4', '#A3A9B2', '#FF8A4C', '#6B7079'],
      surface: ['#111316', '#1C1F23', '#2A2E33', '#1C1F23'],
      border: ['#2A2E33', '#3A3F45', '#6E747D', '#F1F2F4', '#3A3F45'],
      action: ['#F1F2F4', '#111316'],
      status: ['#4CC28A', '#F0CC3C', '#FF5C8A', '#111316', '#2A1A1F'],
      map: ['#1C1F23', '#2A2E33', '#FF8A4C', '#A3A9B2', '#5AA2FF', '#FF5C8A'],
      profile: ['#FF8A4C', '#FF8A4C'],
      control: ['#F1F2F4', '#111316'],
      tabBar: ['#1C1F23', '#F1F2F4'],
    },
    atlasShape,
  ),
};

/** Хронометр (всегда тёмная): почти чёрный фон, графитовые карточки, ярко-оранжевые кнопка и вкладка. */
export const chrono = appScheme(
  {
    basemap: 'dark',
    text: ['#F5F5F5', '#A1A1A6', '#FF6A1A', '#636366'],
    surface: ['#0B0B0C', '#1C1C1E', '#2C2C2E', '#1C1C1E'],
    border: ['#2C2C2E', '#3A3A3C', '#6C6C70', '#FF6A1A', '#3A3A3C'],
    // тёмный текст на ярком оранжевом: белый не проходит WCAG (F6)
    action: ['#FF6A1A', '#0B0B0C'],
    status: ['#4CC28A', '#F0CC3C', '#FF5C8A', '#0B0B0C', '#2A1A1F'],
    map: ['#161618', '#2C2C2E', '#FF6A1A', '#A1A1A6', '#5AC8FA', '#FF5C8A'],
    profile: ['#FF6A1A', '#FF6A1A'],
    control: ['#FF6A1A', '#0B0B0C'],
    tabBar: ['#0B0B0C', '#FF6A1A'],
  },
  shape([12, 10, radius.pill, 12, 20]),
);

/** Планировщик: тёплый бежево-серый фон, чёрные линии маршрута и профиля, оранжевый — только трек. */
const plannerShape = shape([radius.pill, 12, radius.pill, 14, 24]);
export const planner = {
  light: appScheme(
    {
      basemap: 'light',
      text: ['#141412', '#57544D', '#B23C0A', '#8C887F'],
      surface: ['#ECEAE4', '#F7F6F2', '#DEDBD3', '#DEDBD3'],
      border: ['#DCD9D1', '#C9C5BB', '#7A766F', '#141412', '#DCD9D1'],
      action: ['#141412', '#FFFFFF'],
      status: ['#1B6E3F', '#6F5900', '#A50E36', '#FFFFFF', '#F6E6E3'],
      map: ['#E7E4DC', '#D3CFC5', '#141412', '#57544D', '#B23C0A', '#A50E36'],
      profile: ['#141412', '#57544D'],
      control: ['#141412', '#FFFFFF'],
      tabBar: ['#F7F6F2', '#141412'],
    },
    plannerShape,
  ),
  dark: appScheme(
    {
      basemap: 'dark',
      text: ['#F0EEE8', '#A8A398', '#FF8A4C', '#6F6B62'],
      surface: ['#161512', '#211F1B', '#2E2B26', '#211F1B'],
      border: ['#2E2B26', '#3D3A33', '#76716A', '#F0EEE8', '#3D3A33'],
      action: ['#F0EEE8', '#161512'],
      status: ['#4CC28A', '#F0CC3C', '#FF5C8A', '#161512', '#2A1A1F'],
      map: ['#211F1B', '#2E2B26', '#F0EEE8', '#A8A398', '#FF8A4C', '#FF5C8A'],
      profile: ['#F0EEE8', '#A8A398'],
      control: ['#F0EEE8', '#161512'],
      tabBar: ['#211F1B', '#F0EEE8'],
    },
    plannerShape,
  ),
};

/** Журнал: светлый зеленоватый фон; кнопка, маршрут и профиль — зелёные. */
const journalShape = shape([12, 10, radius.pill, 14, 20]);
export const journal = {
  light: appScheme(
    {
      basemap: 'light',
      text: ['#18201A', '#525D55', '#22702A', '#879086'],
      surface: ['#EEF2EA', '#FAFBF8', '#DDE3D8', '#DDE3D8'],
      border: ['#DDE3D8', '#C8D0C2', '#77827A', '#18201A', '#DDE3D8'],
      action: ['#22702A', '#FFFFFF'],
      status: ['#1B6E3F', '#6F5900', '#A50E36', '#FFFFFF', '#F6E6E3'],
      map: ['#E6ECE1', '#D2DACB', '#2E7D32', '#525D55', '#C2410C', '#A50E36'],
      profile: ['#2E7D32', '#43A047'],
      control: ['#22702A', '#FFFFFF'],
      tabBar: ['#FAFBF8', '#18201A'],
    },
    journalShape,
  ),
  dark: appScheme(
    {
      basemap: 'dark',
      text: ['#EDF2EA', '#9FAA9F', '#6CCB7A', '#66706A'],
      surface: ['#101511', '#1A211B', '#263027', '#1A211B'],
      border: ['#263027', '#344036', '#6C786D', '#EDF2EA', '#344036'],
      action: ['#6CCB7A', '#101511'],
      status: ['#4CC28A', '#F0CC3C', '#FF5C8A', '#101511', '#2A1A1F'],
      map: ['#1A211B', '#263027', '#6CCB7A', '#9FAA9F', '#FF8A4C', '#FF5C8A'],
      profile: ['#6CCB7A', '#6CCB7A'],
      control: ['#6CCB7A', '#101511'],
      tabBar: ['#1A211B', '#EDF2EA'],
    },
    journalShape,
  ),
};

/** Навигация (всегда тёмная): синий акцент маршрута, фокуса и тумблера, оранжевый трек, светлая кнопка. */
export const navigation = appScheme(
  {
    basemap: 'dark',
    text: ['#F2F4F7', '#A0A7B1', '#5BA8FF', '#646B75'],
    surface: ['#0F1215', '#1B1F24', '#2A2F36', '#1B1F24'],
    border: ['#2A2F36', '#39404A', '#6B727C', '#5BA8FF', '#39404A'],
    action: ['#F2F4F7', '#0F1215'],
    status: ['#4CC28A', '#F0CC3C', '#FF5C8A', '#0F1215', '#2A1A1F'],
    map: ['#161A1E', '#2A2F36', '#5BA8FF', '#A0A7B1', '#FF8A3D', '#FF5C8A'],
    profile: ['#5BA8FF', '#5BA8FF'],
    control: ['#5BA8FF', '#0F1215'],
    tabBar: ['#0F1215', '#F2F4F7'],
  },
  shape([radius.pill, 12, radius.pill, 16, 24]),
);

/** Типографика: тёплый светлый фон, оранжевая кнопка с тёмным текстом (F6), заглавные подписи кнопок. */
const typographyShape = shape([8, 4, 4, 0, 16], 'upper');
export const typography = {
  light: appScheme(
    {
      basemap: 'light',
      text: ['#0D0D0D', '#57534E', '#B93C0B', '#8F8A83'],
      surface: ['#F6F4F0', '#FFFFFF', '#E6E2DB', '#E6E2DB'],
      border: ['#E6E2DB', '#D2CDC4', '#827D75', '#0D0D0D', '#E6E2DB'],
      action: ['#FF5A1F', '#0D0D0D'],
      status: ['#1B6E3F', '#7A6200', '#A50E36', '#FFFFFF', '#FBEDEB'],
      map: ['#EFECE6', '#DCD8D0', '#D9480F', '#57534E', '#1D6FD8', '#A50E36'],
      profile: ['#D9480F', '#FF5A1F'],
      control: ['#0D0D0D', '#FFFFFF'],
      tabBar: ['#FFFFFF', '#0D0D0D'],
    },
    typographyShape,
  ),
  dark: appScheme(
    {
      basemap: 'dark',
      text: ['#F6F4F0', '#A6A19A', '#FF7A45', '#6E6A64'],
      surface: ['#0D0D0D', '#1A1918', '#2A2826', '#1A1918'],
      border: ['#2A2826', '#3A3734', '#716C66', '#F6F4F0', '#3A3734'],
      action: ['#FF5A1F', '#0D0D0D'],
      status: ['#4CC28A', '#F0CC3C', '#FF5C8A', '#0D0D0D', '#2A1A1F'],
      map: ['#1A1918', '#2A2826', '#FF7A45', '#A6A19A', '#5AA2FF', '#FF5C8A'],
      profile: ['#FF7A45', '#FF5A1F'],
      control: ['#FF5A1F', '#0D0D0D'],
      tabBar: ['#1A1918', '#F6F4F0'],
    },
    typographyShape,
  ),
};
