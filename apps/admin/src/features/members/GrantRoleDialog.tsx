import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf } from '@pokatim/api-client';
import { GrantRoleRequest, PANEL_ROLES } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { api } from '../../api';
import { fieldErrorText } from '../../field-errors';
import { Banner, Button, Dialog, SelectField, TextField } from '../../ui';
import { EMAIL_FIELD_CODES, memberErrorText } from './member-errors';
import { MEMBERS_QUERY_KEY } from './members-query';

const ROLE_OPTIONS = PANEL_ROLES.map((role) => ({ value: role, label: t(`admin.role.${role}`) }));

/**
 * «Выдать роль» — существующему пользователю приложения с подтверждённым e-mail (R4а): нет аккаунта, не подтверждён,
 * уже в команде — ошибка под полем e-mail; прочие — в окне.
 */
export function GrantRoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [failure, setFailure] = useState<string>();
  const form = useForm({
    resolver: zodResolver(GrantRoleRequest),
    defaultValues: { email: '', displayName: '', role: 'moderator' as const },
  });
  const close = () => {
    form.reset();
    setFailure(undefined);
    onClose();
  };
  const grant = useMutation({
    mutationFn: (body: GrantRoleRequest) => api.grantRole(body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: MEMBERS_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
      ]);
      close();
    },
    onError: (error) => {
      const code = apiErrorOf(error)?.code ?? '';
      if (EMAIL_FIELD_CODES.has(code)) {
        form.setError('email', { type: 'server', message: memberErrorText(error) });
      } else {
        setFailure(memberErrorText(error));
      }
    },
  });
  const errors = form.formState.errors;
  // ошибки сервера уже текст; ошибки схемы — коды контракта
  const emailError =
    errors.email?.type === 'server' ? errors.email.message : fieldErrorText(errors.email?.message);

  return (
    <Dialog open={open} title={t('admin.members.grantTitle')} onClose={close}>
      <p className="dialog__consequences t-body">{t('admin.members.grantLead')}</p>
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((body) => {
            setFailure(undefined);
            grant.mutate(body);
          })(event)
        }
      >
        <TextField
          label={t('admin.members.email')}
          type="email"
          autoComplete="off"
          error={emailError}
          {...form.register('email')}
        />
        <TextField
          label={t('admin.members.displayName')}
          autoComplete="off"
          error={fieldErrorText(errors.displayName?.message)}
          {...form.register('displayName')}
        />
        <SelectField
          label={t('admin.members.role')}
          options={ROLE_OPTIONS}
          {...form.register('role')}
        />
        {failure ? (
          <Banner tone="error" role="alert">
            {failure}
          </Banner>
        ) : null}
        <div className="dialog__actions">
          <Button onClick={close} disabled={grant.isPending}>
            {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
          </Button>
          <Button type="submit" variant="primary" busy={grant.isPending}>
            {t('admin.members.grantSubmit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
