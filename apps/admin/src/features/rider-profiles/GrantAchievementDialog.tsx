import {
  ACHIEVEMENT_CODES,
  ACHIEVEMENT_LEVELS,
  ACHIEVEMENT_OBJECT_KIND_BY_CODE,
  type AchievementCode,
  type AchievementLevel,
  type GrantRiderAchievementRequest,
  isLeveledCode,
  isSeasonalCode,
  type RiderAchievementAdminItem,
  Uuid,
} from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useState } from 'react';

import { api } from '../../api';
import { Banner, ReasonDialog, SelectField, TextField } from '../../ui';
import {
  achievementActionErrorText,
  hasObjectError,
  isInvalidState,
  isVisible,
} from './rider-achievements-format';

const DEFAULT_LEVEL: AchievementLevel = 'bronze';

const LEVEL_OPTIONS = ACHIEVEMENT_LEVELS.map((value) => ({
  value,
  label: t(`achievements.level.${value}`),
}));

/** Несезонные коды с видимой выдачей: второй выдачи быть не может (сервер ответит 409). */
const grantedCodes = (items: readonly RiderAchievementAdminItem[]) =>
  new Set(
    items.filter((item) => isVisible(item) && !isSeasonalCode(item.code)).map((item) => item.code),
  );

/**
 * «Выдать вручную» (achievements-panel, M3): `ReasonDialog` с кодом каталога, id объекта (подпись — по виду кода,
 * `ACHIEVEMENT_OBJECT_KIND_BY_CODE`) и уровнем счётного (по умолчанию бронза); подтверждение неактивно, пока id не UUID
 * (RC-7). 400 `objectId` — под полем; 409 — текст в окне и перечитывание блока (`onStale`).
 */
export function GrantAchievementDialog({
  open,
  userId,
  items,
  onDone,
  onStale,
  onClose,
}: {
  open: boolean;
  userId: string;
  items: readonly RiderAchievementAdminItem[];
  onDone: () => Promise<void>;
  onStale: () => Promise<void>;
  onClose: () => void;
}) {
  const granted = grantedCodes(items);
  const firstFree = ACHIEVEMENT_CODES.find((value) => !granted.has(value)) ?? ACHIEVEMENT_CODES[0];
  const [picked, setPicked] = useState<AchievementCode>();
  const [objectId, setObjectId] = useState('');
  const [level, setLevel] = useState<AchievementLevel>(DEFAULT_LEVEL);
  const [objectError, setObjectError] = useState(false);
  // выбранный код мог стать выданным после перечитывания блока — тогда первый свободный
  const code = picked && !granted.has(picked) ? picked : firstFree;
  const kind = ACHIEVEMENT_OBJECT_KIND_BY_CODE[code];
  const id = objectId.trim();

  const reset = () => {
    setPicked(undefined);
    setObjectId('');
    setLevel(DEFAULT_LEVEL);
    setObjectError(false);
  };

  const confirm = async (reason: string) => {
    const body: GrantRiderAchievementRequest = {
      code,
      objectId: id,
      ...(isLeveledCode(code) ? { level } : {}),
      reason,
    };
    try {
      await api.grantRiderAchievement(userId, body);
    } catch (error) {
      if (hasObjectError(error)) setObjectError(true);
      if (isInvalidState(error)) await onStale();
      throw error;
    }
    reset();
    await onDone();
  };

  return (
    <ReasonDialog
      open={open}
      title={t('admin.riderAchievements.grantTitle')}
      consequences={t('admin.riderAchievements.grantConsequences')}
      confirmLabel={t('admin.riderAchievements.grantConfirm')}
      confirmDisabled={!Uuid.safeParse(id).success}
      extraFields={
        <>
          <SelectField
            label={t('admin.riderAchievements.field.code')}
            value={code}
            help={granted.size > 0 ? t('admin.riderAchievements.field.codeHelp') : undefined}
            onChange={(event) => {
              setPicked(event.target.value as AchievementCode);
              setObjectError(false);
            }}
            options={ACHIEVEMENT_CODES.map((value) => {
              const name = t(`achievements.${value}.title`);
              return granted.has(value)
                ? {
                    value,
                    label: t('admin.riderAchievements.field.codeGranted', { name }),
                    disabled: true,
                  }
                : { value, label: name };
            })}
          />
          <TextField
            label={t(`admin.riderAchievements.field.object.${kind}`)}
            value={objectId}
            spellCheck={false}
            autoComplete="off"
            help={t(`admin.riderAchievements.field.objectHelp.${kind}`)}
            error={objectError ? t('admin.riderAchievements.error.object') : undefined}
            onChange={(event) => {
              setObjectId(event.target.value);
              setObjectError(false);
            }}
          />
          {isLeveledCode(code) ? (
            <SelectField
              label={t('admin.riderAchievements.field.level')}
              value={level}
              onChange={(event) => setLevel(event.target.value as AchievementLevel)}
              options={LEVEL_OPTIONS}
            />
          ) : null}
          <Banner tone="warning">{t('admin.riderAchievements.reasonWarning')}</Banner>
        </>
      }
      errorText={achievementActionErrorText}
      onConfirm={confirm}
      onClose={() => {
        reset();
        onClose();
      }}
    />
  );
}
