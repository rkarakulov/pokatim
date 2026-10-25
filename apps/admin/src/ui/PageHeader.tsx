import type { ReactNode } from 'react';

/** Голова страницы «Протокол»: крошки, кикер, заголовок Playfair, мета, действия справа, волосяная линия. */
export function PageHeader({
  title,
  crumb,
  kicker,
  meta,
  actions,
}: {
  title: ReactNode;
  crumb?: ReactNode;
  kicker?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-head">
      <div>
        {crumb ? <p className="page-head__crumb t-panel-crumb">{crumb}</p> : null}
        {kicker ? <p className="page-head__kicker t-label">{kicker}</p> : null}
        <h1 className="page-head__title t-panel-title">{title}</h1>
        {meta ? <p className="page-head__meta t-panel-crumb">{meta}</p> : null}
      </div>
      {actions ? <div>{actions}</div> : null}
    </header>
  );
}
