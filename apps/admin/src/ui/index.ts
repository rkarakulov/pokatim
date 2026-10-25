/**
 * Компоненты панели «Протокол» — без доменных импортов; кандидаты в `@rkarakulov/admin-kit` (F6, явное исключение
 * AGENTS.md §4.11 до выноса, task admin-01 C4). Новые экраны панели собираются только из них.
 */
export { AppShell } from './AppShell';
export { AuthCard } from './AuthCard';
export { Banner } from './Banner';
export { Button, type ButtonProps } from './Button';
export { DataTable, type DataTableProps, SKELETON_ROWS } from './DataTable';
export { Dialog } from './Dialog';
export { SelectField, TextAreaField, TextField } from './fields';
export { PageHeader } from './PageHeader';
export { ReasonDialog, type ReasonDialogProps } from './ReasonDialog';
export { EmptyState, ErrorState } from './states';
export { StatusTag } from './StatusTag';
