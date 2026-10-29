import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  EVENT_MATERIAL_FILE_MAX_BYTES,
  EVENT_MATERIAL_NON_FILE_TYPES,
  EVENT_MATERIAL_TYPES,
  EVENT_MATERIAL_UPLOAD_DESCRIPTION_MAX,
  type EventMaterialAdmin,
  type EventMaterialType,
  materialContentIssues,
  type TicketEventKind,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { api } from '../../api';
import { fieldErrorText, formFieldOf, serverFieldErrors } from '../../field-errors';
import { isConflict } from '../../session/errors';
import {
  Banner,
  Button,
  Dialog,
  ReadonlyField,
  SelectField,
  TextAreaField,
  TextField,
} from '../../ui';
import { formatFileSize } from './tickets-query';

interface MaterialValues {
  type: EventMaterialType;
  title: string;
  description: string;
  url: string;
}

const typeOptions = (types: readonly EventMaterialType[]) =>
  types.map((value) => ({ value, label: t(`admin.tickets.materialType.${value}`) }));

const FILE_TYPES = EVENT_MATERIAL_TYPES.filter(
  (type) => !EVENT_MATERIAL_NON_FILE_TYPES.includes(type),
);
const NON_FILE_TYPES = EVENT_MATERIAL_TYPES.filter((type) => type !== 'pdf');

const orNull = (value: string) => (value.trim() === '' ? null : value.trim());

/** Ошибка сохранения материала, не привязанная к полю. */
function failureText(error: unknown): string {
  const apiError = apiErrorOf(error);
  if (apiError?.code === 'TICKETING_INVALID_STATE') {
    const reason = (apiError.details as { reason?: string } | undefined)?.reason;
    if (reason === 'materials_limit' || reason === 'files_limit') {
      return t(`admin.tickets.invalidState.${reason}`);
    }
  }
  return isNetworkError(error) ? t('error.network') : t('admin.saveFailed');
}

/**
 * Ссылка или текст: новый или правка (RC-C5 — поле ссылки по типу; у материала с PDF ссылки нет). Правила содержимого
 * — `materialContentIssues` контракта до запроса, ошибки сервера — под полями, 409 — «обновите».
 */
export function MaterialDialog({
  kind,
  eventId,
  material,
  onClose,
  onSaved,
  onConflict,
}: {
  kind: TicketEventKind;
  eventId: string;
  material?: EventMaterialAdmin;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const hasFile = material?.file != null;
  const [failure, setFailure] = useState<string>();
  const form = useForm<MaterialValues>({
    defaultValues: {
      type: material?.type ?? 'link',
      title: material?.title ?? '',
      description: material?.description ?? '',
      url: material?.url ?? '',
    },
  });
  const type = useWatch({ control: form.control, name: 'type' });
  const showUrl = !hasFile && type !== 'text';
  const save = useMutation({
    mutationFn: (values: MaterialValues) => {
      const content = {
        type: values.type,
        title: values.title,
        description: values.description,
        url: showUrl ? orNull(values.url) : null,
      };
      return material
        ? api.updateEventMaterial(kind, eventId, material.id, {
            ...content,
            ...(hasFile ? { url: undefined } : {}),
            version: material.version,
          })
        : api.createEventMaterial(kind, eventId, content);
    },
    onSuccess: onSaved,
    onError: (error) => {
      if (isConflict(error)) return onConflict();
      const fields = serverFieldErrors(error);
      if (fields?.length) {
        for (const field of fields) {
          form.setError(formFieldOf(field.path) as keyof MaterialValues, {
            type: 'server',
            message: field.code,
          });
        }
        return;
      }
      setFailure(failureText(error));
    },
  });
  const errorOf = (field: keyof MaterialValues) =>
    fieldErrorText(form.formState.errors[field]?.message);

  return (
    <Dialog
      open
      title={t(
        material ? 'admin.tickets.materials.dialogEdit' : 'admin.tickets.materials.dialogNew',
      )}
      onClose={onClose}
    >
      <form
        noValidate
        className="form-stack"
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            setFailure(undefined);
            const issues = materialContentIssues({
              type: values.type,
              url: showUrl ? orNull(values.url) : null,
              description: orNull(values.description),
              hasFile,
            });
            for (const issue of issues) {
              form.setError(issue.path, { type: 'client', message: issue.code });
            }
            const noTitle = !values.title.trim();
            if (noTitle) form.setError('title', { type: 'client', message: 'REQUIRED' });
            if (issues.length > 0 || noTitle) return;
            save.mutate(values);
          })(event)
        }
      >
        {failure ? (
          <Banner tone="error" role="alert">
            {failure}
          </Banner>
        ) : null}
        <SelectField
          label={t('admin.tickets.field.type')}
          options={typeOptions(hasFile ? FILE_TYPES : NON_FILE_TYPES)}
          error={errorOf('type')}
          {...form.register('type')}
        />
        <TextField
          label={t('admin.tickets.field.title')}
          autoComplete="off"
          maxLength={120}
          error={errorOf('title')}
          {...form.register('title')}
        />
        {showUrl ? (
          <TextField
            label={t('admin.tickets.materials.url')}
            type="url"
            autoComplete="off"
            error={errorOf('url')}
            {...form.register('url')}
          />
        ) : null}
        <TextAreaField
          label={t('admin.tickets.field.description')}
          rows={3}
          maxLength={1000}
          error={errorOf('description')}
          {...form.register('description')}
        />
        <div className="form-actions">
          <Button type="submit" variant="primary" busy={save.isPending} disabled={save.isPending}>
            {t('admin.tickets.save')}
          </Button>
          <Button onClick={onClose}>{t('admin.tickets.cancel')}</Button>
        </div>
      </form>
    </Dialog>
  );
}

interface UploadValues {
  type: EventMaterialType;
  title: string;
  description: string;
}

/**
 * Загрузка PDF после выбора файла: тема (без ссылочных), название (по умолчанию — имя файла), описание. Размер больше
 * 10 МБ — подсказка сразу (проверяет сервер); 413/415 — «Только PDF до 10 МБ» под файлом.
 */
export function MaterialUploadDialog({
  kind,
  eventId,
  file,
  onClose,
  onSaved,
}: {
  kind: TicketEventKind;
  eventId: string;
  file: File;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [failure, setFailure] = useState<string>();
  const [fileError, setFileError] = useState(file.size > EVENT_MATERIAL_FILE_MAX_BYTES);
  const form = useForm<UploadValues>({
    defaultValues: {
      type: 'pdf',
      title: file.name.replace(/\.pdf$/i, '').slice(0, 120),
      description: '',
    },
  });
  const upload = useMutation({
    mutationFn: (values: UploadValues) =>
      api.uploadEventMaterial(kind, eventId, file, {
        type: values.type,
        title: values.title,
        ...(values.description.trim() ? { description: values.description } : {}),
        fileName: file.name.slice(0, 120),
      }),
    onSuccess: onSaved,
    onError: (error) => {
      const code = apiErrorOf(error)?.code;
      if (code === 'MATERIAL_FILE_UNSUPPORTED' || code === 'MATERIAL_FILE_TOO_LARGE') {
        return setFileError(true);
      }
      // ошибки полей формы — под полями; поле вне формы (`fileName`) — общий текст, иначе экран молчит
      let shown = false;
      for (const field of serverFieldErrors(error) ?? []) {
        const name = formFieldOf(field.path);
        if (name === 'type' || name === 'title' || name === 'description') {
          form.setError(name, { type: 'server', message: field.code });
          shown = true;
        }
      }
      if (!shown) setFailure(failureText(error));
    },
  });
  const errorOf = (field: keyof UploadValues) =>
    fieldErrorText(form.formState.errors[field]?.message);

  return (
    <Dialog open title={t('admin.tickets.materials.dialogUpload')} onClose={onClose}>
      <form
        noValidate
        className="form-stack"
        onSubmit={(event) =>
          void form.handleSubmit((values) => {
            setFailure(undefined);
            if (!values.title.trim()) {
              form.setError('title', { type: 'client', message: 'REQUIRED' });
              return;
            }
            upload.mutate(values);
          })(event)
        }
      >
        {failure ? (
          <Banner tone="error" role="alert">
            {failure}
          </Banner>
        ) : null}
        <ReadonlyField
          label={t('admin.tickets.materials.file')}
          value={`${file.name} · ${formatFileSize(file.size)}`}
          help={
            fileError ? (
              <span className="field__error" role="alert">
                {t('admin.tickets.materials.fileRule')}
              </span>
            ) : (
              t('admin.tickets.materials.fileRule')
            )
          }
        />
        <SelectField
          label={t('admin.tickets.field.type')}
          options={typeOptions(FILE_TYPES)}
          error={errorOf('type')}
          {...form.register('type')}
        />
        <TextField
          label={t('admin.tickets.field.title')}
          autoComplete="off"
          maxLength={120}
          error={errorOf('title')}
          {...form.register('title')}
        />
        <TextAreaField
          label={t('admin.tickets.field.description')}
          rows={3}
          maxLength={EVENT_MATERIAL_UPLOAD_DESCRIPTION_MAX}
          error={errorOf('description')}
          {...form.register('description')}
        />
        <div className="form-actions">
          <Button
            type="submit"
            variant="primary"
            busy={upload.isPending}
            disabled={upload.isPending}
          >
            {t('admin.tickets.materials.uploadSubmit')}
          </Button>
          <Button onClick={onClose}>{t('admin.tickets.cancel')}</Button>
        </div>
      </form>
    </Dialog>
  );
}
