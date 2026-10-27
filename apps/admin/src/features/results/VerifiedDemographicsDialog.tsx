import {
  ACTION_REASON_MAX_LENGTH,
  ACTION_REASON_MIN_LENGTH,
  type PanelVerifiedDemographics,
  RIDER_GENDERS,
  type RiderGender,
  UpdateVerifiedDemographicsRequest,
  VerifiedBirthYear,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useId, useState } from 'react';

import { api } from '../../api';
import { httpStatus } from '../../session/errors';
import {
  Banner,
  Button,
  Dialog,
  DisabledReason,
  EmptyState,
  ErrorState,
  RadioGroup,
  TextAreaField,
  TextField,
} from '../../ui';
import { demographicsErrorText } from './results-errors';
import { verifiedDemographicsQuery } from './results-query';

/** Райдер, чьи пол и год правятся: `userId` — в запрос, подпись — «Участник ·id» / «Анна К. ·id». */
export interface DemographicsTarget {
  userId: string;
  label: string;
}

const SKELETON_FIELDS = 2;

function Actions({
  onClose,
  busy = false,
  children,
}: {
  onClose: () => void;
  busy?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="dialog__actions">
      <Button onClick={onClose} disabled={busy}>
        {t('admin.dialog.cancel')} <kbd className="kbd t-meta-xs">{t('admin.dialog.esc')}</kbd>
      </Button>
      {children}
    </div>
  );
}

/**
 * Форма правки: только изменённые поля и причина (в журнал на сервере — имена полей, без значений). Год проверяет
 * схема контракта (`VerifiedBirthYear`); «Сохранить» неактивна без изменений, с неверным годом и без причины.
 */
function DemographicsForm({
  userId,
  current,
  onClose,
}: {
  userId: string;
  current: PanelVerifiedDemographics;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const reasonId = useId();
  const [gender, setGender] = useState<RiderGender>(current.gender);
  const [year, setYear] = useState(String(current.birthYear));
  const [reason, setReason] = useState('');
  const save = useMutation({
    mutationFn: (body: UpdateVerifiedDemographicsRequest) =>
      api.updateVerifiedDemographics(userId, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'audit'] }),
  });

  const parsedYear = VerifiedBirthYear.safeParse(Number(year));
  const yearValid = year.trim() !== '' && parsedYear.success;
  const body = UpdateVerifiedDemographicsRequest.safeParse({
    ...(gender !== current.gender ? { gender } : {}),
    ...(yearValid && parsedYear.data !== current.birthYear ? { birthYear: parsedYear.data } : {}),
    reason: reason.trim(),
  });
  const changed = gender !== current.gender || (yearValid && parsedYear.data !== current.birthYear);
  const blocked = !changed ? t('admin.results.demographics.unchanged') : undefined;
  const ready =
    yearValid && body.success && reason.trim().length >= ACTION_REASON_MIN_LENGTH && !blocked;

  const close = () => {
    if (!save.isPending) onClose();
  };

  return (
    <>
      <RadioGroup
        legend={t('admin.results.demographics.gender')}
        options={RIDER_GENDERS.map((value) => ({
          value,
          label: t(`admin.results.demographics.gender.${value}`),
        }))}
        value={gender}
        onChange={setGender}
      />
      <TextField
        label={t('admin.results.demographics.birthYear')}
        type="number"
        inputMode="numeric"
        value={year}
        error={yearValid ? undefined : t('admin.results.demographics.birthYearInvalid')}
        help={t(
          current.demographicsLocked
            ? 'admin.results.demographics.locked'
            : 'admin.results.demographics.unlocked',
        )}
        onChange={(event) => setYear(event.target.value)}
      />
      <TextAreaField
        label={t('admin.dialog.reason')}
        value={reason}
        maxLength={ACTION_REASON_MAX_LENGTH}
        onChange={(event) => setReason(event.target.value)}
      />
      {save.isError ? (
        <Banner tone="error" role="alert">
          {demographicsErrorText(save.error)}
        </Banner>
      ) : null}
      <Actions onClose={close} busy={save.isPending}>
        <Button
          variant="primary"
          disabled={!ready}
          busy={save.isPending}
          aria-describedby={blocked ? reasonId : undefined}
          onClick={() => {
            if (!ready || !body.success) return;
            save.mutate(body.data, { onSuccess: onClose });
          }}
        >
          {t('admin.results.demographics.submit')}
        </Button>
      </Actions>
      {blocked ? <DisabledReason id={reasonId}>{blocked}</DisabledReason> : null}
    </>
  );
}

/**
 * Правка пола и года рождения анкеты Verified (race-results-07, только `profiles.verified_edit`): текущие значения —
 * с сервера при открытии (`gcTime: 0`), вес, рост и FTP панель не получает. Существующие заявки не меняются.
 */
export function VerifiedDemographicsDialog({
  target,
  onClose,
}: {
  target: DemographicsTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      title={t('admin.results.demographics.title', { rider: target?.label ?? '' })}
      onClose={onClose}
    >
      <p className="dialog__consequences t-body">{t('admin.results.demographics.consequences')}</p>
      {target ? <DemographicsBody userId={target.userId} onClose={onClose} /> : null}
    </Dialog>
  );
}

function DemographicsBody({ userId, onClose }: { userId: string; onClose: () => void }) {
  const current = useQuery(verifiedDemographicsQuery(userId));
  if (current.data) {
    return (
      <DemographicsForm key={userId} userId={userId} current={current.data} onClose={onClose} />
    );
  }
  if (current.isError || current.fetchStatus === 'paused') {
    return (
      <>
        {httpStatus(current.error) === 404 ? (
          <EmptyState title={t('admin.results.demographics.noProfile')} />
        ) : (
          <ErrorState
            error={current.error}
            offline={current.fetchStatus === 'paused'}
            onRetry={() => void current.refetch()}
          />
        )}
        <Actions onClose={onClose} />
      </>
    );
  }
  return (
    <>
      <div aria-busy="true">
        {Array.from({ length: SKELETON_FIELDS }, (_, index) => (
          <div key={index} className="field" data-testid="skeleton-field">
            <span className="skeleton t-label"> </span>
            <span className="skeleton table__skeleton field__control"> </span>
          </div>
        ))}
      </div>
      <Actions onClose={onClose}>
        <Button variant="primary" disabled>
          {t('admin.results.demographics.submit')}
        </Button>
      </Actions>
    </>
  );
}
