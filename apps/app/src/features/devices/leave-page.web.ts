/** Уход со страницы на внешний адрес (авторизация агрегатора): вкладка загрузит его вместо приложения. */
export function leavePageTo(url: string): void {
  window.location.assign(url);
}
