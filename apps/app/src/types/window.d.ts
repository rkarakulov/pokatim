// id темы приложения процесса SSR для гидрации без мигания (`+html.tsx`, `initial-theme-id.web.ts`); значение не
// доверенное — только через `toAppThemeId`
interface Window {
  __POKATIM_THEME__?: string;
}
