import type { ReactNode } from 'react';

/** Метка статуса в таблице (грамматика пилюль приложения, плотная). */
export function StatusTag({
  tone,
  children,
}: {
  tone: 'success' | 'neutral' | 'error' | 'ink';
  children: ReactNode;
}) {
  return <span className={`status-tag status-tag--${tone} t-pill`}>{children}</span>;
}
