import {
  defineThemes,
  type ColorRoles as BaseColorRoles,
  type FontStack,
  type NavRoles,
} from '@rkarakulov/design-tokens';

/**
 * Палитра pokatim из CSS прототипов («Воздух», визуальный слой «Ателье»). Только внутри этого файла:
 * компоненты и приложения используют роли тем (`useTheme()` / CSS-переменные), не палитру.
 */
const color = {
  neutral0: '#FFFFFF',
  neutral25: '#F4F4F2',
  neutral50: '#F2F2F0',
  neutral100: '#E2E2DF',
  neutral200: '#CFCFCB',
  neutral400: '#A3A3A3',
  neutral450: '#8A8A87',
  neutral500: '#757575',
  neutral550: '#6E6E6E',
  neutral600: '#5C5C5C',
  neutral700: '#474747',
  neutral750: '#3A3A3A',
  neutral800: '#2E2E2E',
  neutral850: '#1A1A1A',
  neutral900: '#111111',
  neutral950: '#0E0E0E',
  black: '#000000',
  orange600: '#C2410C',
  orange400: '#FF7A45',
  red700: '#B0103A',
  red400: '#FF5C8A',
  red50: '#FBEDEB',
  green700: '#1E7A46',
  green400: '#4CC28A',
  yellow700: '#866C00',
  yellow400: '#F0CC3C',
} as const;

/** Группы ролей pokatim поверх ролей базы: карта маршрута и полоса покрытия. */
export interface PokatimRoleGroups {
  map: {
    background: string;
    line: string;
    route: string;
    corridor: string;
    /** свой трек участника поверх маршрута (maps-02) */
    track: string;
    /** участки трека вне коридора — пунктир, толще (различимы без цвета) */
    offCorridor: string;
  };
  surfaceBar: {
    asphalt: string;
    gravel: string;
    gravelHatch: string;
    outline: string;
  };
}

/**
 * Слой 2 — семантика: роли, а не цвета. Роли базы (`text`, `surface`, …) + группы pokatim;
 * значение роли в каждой теме — из CSS прототипов. Порядок ключей задаёт порядок CSS-переменных.
 */
type ColorRoles = BaseColorRoles & PokatimRoleGroups;

const light: ColorRoles = {
  text: {
    primary: color.neutral900,
    secondary: color.neutral600,
    accent: color.orange600,
    onPrimary: color.neutral0,
    onPhoto: color.neutral0,
    placeholder: color.neutral600,
    disabled: color.neutral450,
  },
  surface: {
    default: color.neutral0,
    raised: color.neutral25,
    sheet: color.neutral0,
    disabled: color.neutral100,
    skeleton: color.neutral25,
  },
  border: {
    subtle: color.neutral100,
    strong: color.neutral200,
    input: color.neutral450,
    focus: color.neutral900,
    sheet: color.neutral100,
  },
  action: { primary: color.neutral900, onPrimary: color.neutral0 },
  status: {
    success: color.green700,
    warning: color.yellow700,
    error: color.red700,
    onError: color.neutral0,
    errorTint: color.red50,
  },
  map: {
    background: color.neutral25,
    line: color.neutral100,
    route: color.neutral900,
    corridor: color.neutral600,
    track: color.orange600,
    offCorridor: color.red700,
  },
  surfaceBar: {
    asphalt: color.neutral900,
    gravel: color.neutral100,
    gravelHatch: color.neutral900,
    outline: color.neutral600,
  },
  overlay: { scrim: color.black },
  // дорожка выкл. — как border.input, а не #CFCFCB прототипа: иначе 1.56:1 < 3:1 (WCAG 1.4.11)
  control: {
    track: color.neutral450,
    trackOn: color.neutral900,
    thumb: color.neutral0,
    thumbOn: color.neutral0,
  },
};

const dark: ColorRoles = {
  text: {
    primary: color.neutral50,
    secondary: color.neutral400,
    accent: color.orange400,
    onPrimary: color.neutral950,
    onPhoto: color.neutral0,
    placeholder: color.neutral400,
    disabled: color.neutral500,
  },
  surface: {
    default: color.neutral950,
    raised: color.neutral850,
    sheet: color.neutral850,
    disabled: color.neutral800,
    skeleton: color.neutral850,
  },
  border: {
    subtle: color.neutral750,
    strong: color.neutral700,
    input: color.neutral550,
    focus: color.neutral50,
    sheet: color.neutral700,
  },
  action: { primary: color.neutral50, onPrimary: color.neutral950 },
  status: {
    success: color.green400,
    warning: color.yellow400,
    error: color.red400,
    onError: color.neutral950,
    // в прототипах тёмного варианта нет (используется только в светлой веб-панели)
    errorTint: color.neutral850,
  },
  map: {
    background: color.neutral850,
    line: color.neutral800,
    route: color.neutral50,
    corridor: color.neutral400,
    track: color.orange400,
    offCorridor: color.red400,
  },
  surfaceBar: {
    asphalt: color.neutral50,
    gravel: color.neutral800,
    gravelHatch: color.neutral50,
    outline: color.neutral400,
  },
  overlay: { scrim: color.black },
  // дорожка выкл. — как border.input, а не #474747 прототипа (WCAG 1.4.11)
  control: {
    track: color.neutral550,
    trackOn: color.neutral50,
    thumb: color.neutral0,
    thumbOn: color.neutral950,
  },
};

const panelNav: NavRoles = {
  background: color.neutral900,
  text: color.neutral200,
  textMuted: color.neutral400,
  activeBackground: color.neutral850,
  activeText: color.neutral0,
  activeIndicator: color.neutral0,
  focus: color.neutral50,
};

/**
 * Бренд проекта — единственное место палитры и гарнитур: Jersey Aura — светлая приложения и лендинга,
 * Night Ride — тёмная, `panel` — веб-панель «Протокол»: светлая семантика + тёмная навигация
 * (+ плотность базы в CSS). Приложения палитру не импортируют.
 */
export const themes = defineThemes({
  light,
  dark,
  panel: { ...light, nav: panelNav },
});
export type ThemeName = keyof typeof themes;

/** Гарнитуры приложения (`@expo-google-fonts/*`) и веба (`@fontsource/*`): Playfair Display + Inter. */
export const font = {
  display: 'Playfair Display',
  text: 'Inter',
} as const;

/** Стеки с фолбэками для веба. */
export const fontStack: FontStack = {
  display: "'Playfair Display', 'PT Serif', Georgia, 'Times New Roman', serif",
  text: 'Inter, system-ui, Arial, Helvetica, sans-serif',
};
