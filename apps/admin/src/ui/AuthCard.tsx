import { t } from '@pokatim/i18n';
import type { ReactNode } from 'react';

/**
 * Окно страниц без каркаса (вход и его состояния, прототип 3a): название продукта и «Панель команды платформы» над
 * окном, окно по центру на `surface`.
 */
export function AuthCard({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <main className="auth">
      <p className="auth__brand t-brand">{t('app.name')}</p>
      <p className="auth__role t-label">{t('admin.title')}</p>
      <section className="auth__box" aria-labelledby="auth-title">
        <h1 id="auth-title" className="t-panel-title-sm">
          {title}
        </h1>
        {children}
      </section>
    </main>
  );
}
