import { isNetworkError } from '@pokatim/api-client';
import type { EventMaterialAdmin, TicketEventKind } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { api } from '../../api';
import { httpStatus, isConflict } from '../../session/errors';
import {
  Banner,
  Button,
  ConflictBanner,
  Dialog,
  DisabledReason,
  EmptyState,
  ErrorState,
  FileButton,
  RefreshFailedBanner,
  StatusTag,
} from '../../ui';
import { MaterialDialog, MaterialUploadDialog } from './MaterialDialogs';
import { formatFileSize, materialsQuery, ticketsKey } from './tickets-query';

const SKELETON_ROWS = 3;

const sourceOf = (material: EventMaterialAdmin) =>
  material.file
    ? t('admin.tickets.materials.source.pdf', { size: formatFileSize(material.file.size) })
    : material.url
      ? t('admin.tickets.materials.source.link')
      : t('admin.tickets.materials.source.text');

type Editing = { kind: 'new' } | { kind: 'edit'; material: EventMaterialAdmin };

/**
 * «Материалы» события: список по порядку (тип, название, источник), «Выше»/«Ниже» — полный набор id (без
 * перетаскивания, кнопки неактивны до ответа; 409 — перечитать и «обновите»), «Изменить», «Удалить» (подтверждение;
 * 404 — уже удалён, перечитать); сбой перечитывания при загруженном списке — баннер с повтором поверх него;
 * «Добавить материал» и «Загрузить PDF» — с остатком лимитов, на пределе — `aria-disabled` с причиной.
 */
export function MaterialsSection({ kind, eventId }: { kind: TicketEventKind; eventId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery(materialsQuery(kind, eventId));
  const [editing, setEditing] = useState<Editing>();
  const [file, setFile] = useState<File>();
  const [removing, setRemoving] = useState<EventMaterialAdmin>();
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string>();
  const addReasonId = useId();
  const uploadReasonId = useId();

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ticketsKey(kind, eventId) });
    await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
  };
  const onError = (error: unknown) => {
    if (isConflict(error)) {
      setConflict(true);
      void refresh();
      return;
    }
    setFailure(isNetworkError(error) ? t('error.network') : t('admin.saveFailed'));
  };
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api.reorderEventMaterials(kind, eventId, { ids }),
    onSuccess: async (next) => {
      queryClient.setQueryData(materialsQuery(kind, eventId).queryKey, next);
      await queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] });
    },
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteEventMaterial(kind, eventId, id),
    onSuccess: refresh,
    // 404 — материал уже удалили (другая вкладка, коллега): список устарел, как при конфликте — перечитать
    onError: (error) => (httpStatus(error) === 404 ? void refresh() : onError(error)),
  });

  const data = query.data;
  if (!data) {
    if (query.isError || query.fetchStatus === 'paused') {
      return (
        <ErrorState
          error={query.error}
          offline={query.fetchStatus === 'paused'}
          onRetry={() => void query.refetch()}
        />
      );
    }
    return (
      <ul className="materials" aria-busy="true">
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <li key={index} className="materials__row" data-testid="skeleton-material">
            <span className="skeleton t-body"> </span>
          </li>
        ))}
      </ul>
    );
  }

  const items = data.items;
  const move = (index: number, delta: number) => {
    const ids = items.map((item) => item.id);
    const [moved] = ids.splice(index, 1);
    if (moved === undefined) return;
    ids.splice(index + delta, 0, moved);
    setFailure(undefined);
    reorder.mutate(ids);
  };
  const noItems = data.itemsLeft === 0;
  const noFiles = noItems || data.filesLeft === 0;
  const busy = reorder.isPending || remove.isPending;

  return (
    <div className="form-stack">
      {query.isError ? (
        <RefreshFailedBanner busy={query.isFetching} onRetry={() => void query.refetch()} />
      ) : null}
      {conflict ? (
        <ConflictBanner
          onReload={() => {
            setConflict(false);
            void refresh();
          }}
        />
      ) : null}
      {failure ? (
        <Banner tone="error" role="alert">
          {failure}
        </Banner>
      ) : null}
      {items.length === 0 ? (
        <EmptyState title={t('admin.tickets.materials.empty')} />
      ) : (
        <ol className="materials">
          {items.map((material, index) => (
            <li key={material.id} className="materials__row">
              <div className="materials__info">
                <StatusTag tone="neutral">
                  {t(`admin.tickets.materialType.${material.type}`)}
                </StatusTag>{' '}
                <span className="t-body">{material.title}</span>
                <span className="muted t-meta"> · {sourceOf(material)}</span>
              </div>
              <div className="materials__actions">
                <Button
                  size="sm"
                  disabled={busy || index === 0}
                  aria-label={t('admin.tickets.materials.moveUp', { title: material.title })}
                  onClick={() => move(index, -1)}
                >
                  {t('admin.tickets.materials.up')}
                </Button>
                <Button
                  size="sm"
                  disabled={busy || index === items.length - 1}
                  aria-label={t('admin.tickets.materials.moveDown', { title: material.title })}
                  onClick={() => move(index, 1)}
                >
                  {t('admin.tickets.materials.down')}
                </Button>
                <Button size="sm" onClick={() => setEditing({ kind: 'edit', material })}>
                  {t('admin.tickets.materials.edit')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => setRemoving(material)}>
                  {t('admin.tickets.materials.remove')}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="form-actions">
        <Button
          aria-disabled={noItems || undefined}
          aria-describedby={noItems ? addReasonId : undefined}
          onClick={() => {
            if (!noItems) setEditing({ kind: 'new' });
          }}
        >
          {t('admin.tickets.materials.add')}
        </Button>
        <FileButton
          label={t('admin.tickets.materials.upload')}
          accept="application/pdf,.pdf"
          aria-disabled={noFiles || undefined}
          aria-describedby={noFiles ? uploadReasonId : undefined}
          onFile={(picked) => {
            if (!noFiles) setFile(picked);
          }}
        />
        <span className="muted t-meta">
          {t('admin.tickets.materials.left', { items: data.itemsLeft, files: data.filesLeft })}
        </span>
        {noItems ? (
          <DisabledReason id={addReasonId}>
            {t('admin.tickets.materials.limitReason')}
          </DisabledReason>
        ) : null}
        {noFiles ? (
          <DisabledReason id={uploadReasonId}>
            {t('admin.tickets.materials.limitReason')}
          </DisabledReason>
        ) : null}
      </div>
      {editing ? (
        <MaterialDialog
          kind={kind}
          eventId={eventId}
          material={editing.kind === 'edit' ? editing.material : undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void refresh();
          }}
          onConflict={() => {
            setEditing(undefined);
            setConflict(true);
            void refresh();
          }}
        />
      ) : null}
      {file ? (
        <MaterialUploadDialog
          kind={kind}
          eventId={eventId}
          file={file}
          onClose={() => setFile(undefined)}
          onSaved={() => {
            setFile(undefined);
            void refresh();
          }}
        />
      ) : null}
      <Dialog
        open={removing !== undefined}
        title={t('admin.tickets.materials.removeTitle')}
        onClose={() => setRemoving(undefined)}
      >
        <p className="t-body">
          {t('admin.tickets.materials.removeMessage', { title: removing?.title ?? '' })}
        </p>
        <div className="form-actions">
          <Button
            variant="danger"
            onClick={() => {
              if (removing) remove.mutate(removing.id);
              setRemoving(undefined);
            }}
          >
            {t('admin.tickets.materials.remove')}
          </Button>
          <Button onClick={() => setRemoving(undefined)}>{t('admin.tickets.cancel')}</Button>
        </div>
      </Dialog>
    </div>
  );
}
