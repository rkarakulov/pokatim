import { zodResolver } from '@hookform/resolvers/zod';
import {
  MIN_AGE_YEARS,
  minskToday,
  RIDER_GENDERS,
  UpdateVerifiedProfileRequest,
  VERIFIED_LIMITS,
  VerifiedBirthYear,
  type VerifiedProfileView,
} from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, Checkbox, Chip, TextField, textStyle, useTheme } from '@rkarakulov/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import {
  actionErrorMessage,
  apiErrorCode,
  fieldErrorMessage,
  serverFieldErrors,
} from '@/features/auth/error-messages';

import { useUpdateVerifiedProfile, VERIFIED_PROFILE_KEY } from './queries';

const shape = UpdateVerifiedProfileRequest.shape;
/** Текст поля → целое число; пусто или не число — `NaN` (схема contracts отклонит с кодом `INVALID`). */
const intText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? Number.NaN : Number(value)));
/** Необязательное число: пусто — `null`. */
const optionalIntText = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : Number(value)));

/** Поля формы — строки, проверка — схемы contracts (`UpdateVerifiedProfileRequest`). */
const VerifiedForm = z.object({
  // поле ввода — строка (пока не выбрано — пусто), флажок — boolean; проверка — схемы contracts
  gender: z.string().pipe(shape.gender),
  birthYear: intText.pipe(VerifiedBirthYear),
  weightKg: intText.pipe(shape.weightKg),
  heightCm: intText.pipe(shape.heightCm),
  ftpW: optionalIntText.pipe(shape.ftpW),
  consent: z.boolean().pipe(shape.consent),
});
type FormValues = z.input<typeof VerifiedForm>;
type FormOutput = z.output<typeof VerifiedForm>;

const FIELDS = ['gender', 'birthYear', 'weightKg', 'heightCm', 'ftpW', 'consent'] as const;
type Field = (typeof FIELDS)[number];

const text = (value: number | null | undefined) => (value == null ? '' : String(value));

function valuesOf(view: VerifiedProfileView): FormValues {
  const profile = view.profile;
  if (profile === null) {
    return {
      gender: '',
      birthYear: text(view.suggestedBirthYear),
      weightKg: '',
      heightCm: '',
      ftpW: '',
      consent: false,
    };
  }
  return {
    gender: profile.gender === 'unknown' ? '' : profile.gender,
    birthYear: text(profile.birthYear),
    weightKg: text(profile.weightKg),
    heightCm: text(profile.heightCm),
    ftpW: text(profile.ftpW),
    // согласие уже дано анкетой; повторная отправка — с тем же согласием
    consent: true,
  };
}

/** Последний допустимый год рождения: текущий год по Минску − 18 (как `VerifiedBirthYear`). */
const maxBirthYear = () => Number(minskToday().slice(0, 4)) - MIN_AGE_YEARS;

const RANGES: Partial<Record<Field, () => readonly [number, number]>> = {
  birthYear: () => [VERIFIED_LIMITS.birthYearMin, maxBirthYear()],
  weightKg: () => VERIFIED_LIMITS.weightKg,
  heightCm: () => VERIFIED_LIMITS.heightCm,
  ftpW: () => VERIFIED_LIMITS.ftpW,
};

/** Текст ошибки поля по коду: числа вне предела — «Целое число от … до …»; прочее — общие тексты полей. */
function fieldText(field: Field, code: string | undefined): string | undefined {
  if (code === undefined) return undefined;
  const range = RANGES[field];
  if (range && (code === 'INVALID' || code === 'AGE_BELOW_18')) {
    const [min, max] = range();
    return t('profile.verified.range', { min, max });
  }
  return fieldErrorMessage(code);
}

/**
 * Анкета зачёта Verified (race-results-07): пол, год рождения (подставлен год регистрации), вес, рост, FTP
 * (необязательно), согласие. После первой Verified-заявки пол и год — только чтение с пояснением «меняет команда
 * платформы» (отправляются прежними). Проверка — схема contracts; ошибки сервера — под полем по коду; `409
 * VERIFIED_DEMOGRAPHICS_LOCKED` — баннер и перезапрос анкеты; сеть, 429 и прочее — баннер над кнопкой.
 */
export function VerifiedProfileFormView({
  view,
  onSaved,
}: {
  view: VerifiedProfileView;
  onSaved?: () => void;
}) {
  const theme = useTheme();
  const queryClient = useQueryClient();
  const update = useUpdateVerifiedProfile();
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string>();
  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(VerifiedForm),
    mode: 'onTouched',
    defaultValues: valuesOf(view),
  });
  const { errors } = form.formState;
  const locked = view.demographicsLocked && view.profile !== null;
  const meta = [textStyle('meta'), { color: theme.text.secondary }];
  const errorStyle = [textStyle('meta'), { color: theme.status.error }];

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false);
    setFailure(undefined);
    try {
      const next = await update.mutateAsync(values);
      form.reset(valuesOf(next));
      setSaved(true);
      onSaved?.();
    } catch (error) {
      const fields = serverFieldErrors(error, FIELDS);
      if (fields.length > 0) {
        for (const { field, code } of fields) {
          form.setError(field, { type: 'server', message: code });
        }
        return;
      }
      if (apiErrorCode(error) === 'VERIFIED_DEMOGRAPHICS_LOCKED') {
        setFailure(t('profile.verified.error.VERIFIED_DEMOGRAPHICS_LOCKED'));
        void queryClient.invalidateQueries({ queryKey: VERIFIED_PROFILE_KEY });
        return;
      }
      setFailure(actionErrorMessage(error));
    }
  });

  const numberField = (
    name: 'birthYear' | 'weightKg' | 'heightCm' | 'ftpW',
    label: string,
    helper?: string,
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <TextField
          label={label}
          value={field.value}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          keyboardType="number-pad"
          autoComplete="off"
          {...(helper ? { helper } : {})}
          error={fieldText(name, errors[name]?.message)}
        />
      )}
    />
  );

  return (
    <View style={styles.form}>
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('profile.verified.lead')}
      </Text>
      {locked ? (
        <View testID="verified-locked" style={styles.stack}>
          <View accessible style={styles.readonly}>
            <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
              {t('profile.verified.gender')}
            </Text>
            <Text style={[textStyle('body'), { color: theme.text.primary }]}>
              {t(`profile.verified.gender.${view.profile?.gender ?? 'unknown'}`)}
            </Text>
          </View>
          <View accessible style={styles.readonly}>
            <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
              {t('profile.verified.birthYear')}
            </Text>
            <Text style={[textStyle('body'), { color: theme.text.primary }]}>
              {text(view.profile?.birthYear)}
            </Text>
          </View>
          <Text style={meta}>{t('profile.verified.locked')}</Text>
        </View>
      ) : (
        <>
          <View style={styles.stack}>
            <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
              {t('profile.verified.gender')}
            </Text>
            <Controller
              control={form.control}
              name="gender"
              render={({ field }) => (
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel={t('profile.verified.gender')}
                  style={styles.chips}
                >
                  {RIDER_GENDERS.map((gender) => (
                    <Chip
                      key={gender}
                      label={t(`profile.verified.gender.${gender}`)}
                      selected={field.value === gender}
                      onPress={() => field.onChange(gender)}
                    />
                  ))}
                </View>
              )}
            />
            {errors.gender ? (
              <Text style={errorStyle}>{fieldText('gender', errors.gender.message)}</Text>
            ) : null}
          </View>
          {numberField(
            'birthYear',
            t('profile.verified.birthYear'),
            view.profile === null && view.suggestedBirthYear !== null
              ? t('profile.verified.birthYearHint')
              : undefined,
          )}
        </>
      )}
      {numberField('weightKg', t('profile.verified.weight'))}
      {numberField('heightCm', t('profile.verified.height'))}
      {numberField('ftpW', t('profile.verified.ftp'))}
      <View style={styles.stack}>
        <Controller
          control={form.control}
          name="consent"
          render={({ field }) => (
            <Checkbox
              label={t('profile.verified.consent')}
              checked={field.value}
              onChange={field.onChange}
            />
          )}
        />
        {errors.consent ? (
          <Text style={errorStyle}>{fieldText('consent', errors.consent.message)}</Text>
        ) : null}
      </View>
      <View style={styles.stack}>
        {failure ? <Banner tone="error" message={failure} /> : null}
        {saved && !form.formState.isDirty ? (
          <Banner tone="info" message={t('profile.verified.saved')} />
        ) : null}
        <Button
          label={t('profile.verified.save')}
          onPress={() => void onSubmit()}
          loading={update.isPending}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.s4 },
  stack: { gap: space.s2 },
  readonly: { gap: space.s1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
});
