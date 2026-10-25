import type { ReactNode } from 'react';

export interface BannerProps {
  tone?: 'neutral' | 'warning' | 'error';
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  /** `alert` — ошибка действия (озвучивается сразу); `status` — сообщение. */
  role?: 'alert' | 'status';
}

/** Баннер панели: нейтральный, предупреждение, ошибка (полоса слева — толщина из токенов). */
export function Banner({
  tone = 'neutral',
  title,
  children,
  actions,
  role = 'status',
}: BannerProps) {
  return (
    <div className={`banner banner--${tone} t-banner`} role={role}>
      {title ? <p className="banner__title t-banner-title">{title}</p> : null}
      {children ? <div>{children}</div> : null}
      {actions ? <div className="banner__actions">{actions}</div> : null}
    </div>
  );
}
