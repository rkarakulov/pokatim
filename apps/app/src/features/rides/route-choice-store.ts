import type { RideRoute } from '@pokatim/contracts';

/**
 * Передача выбора пикера маршрута (`/rides/route-pick?form=…`) в форму райда (05c): только память, без persist и
 * URL. `form` — `new` или id райда в правке: форма забирает только свой выбор (`take` очищает). `route: null` —
 * «Без маршрута». Выбор пишется в обработчике нажатия на клиенте — SSR-процесс его не видит.
 */
export interface RouteChoice {
  form: string;
  route: RideRoute | null;
}

let pending: RouteChoice | null = null;

export const routeChoice = {
  set(choice: RouteChoice): void {
    pending = choice;
  },
  /** Выбор для формы `form` — один раз; чужой не трогается. */
  take(form: string): { route: RideRoute | null } | undefined {
    if (!pending || pending.form !== form) return undefined;
    const { route } = pending;
    pending = null;
    return { route };
  },
  clear(): void {
    pending = null;
  },
};
