import { zodResolver } from '@hookform/resolvers/zod';
import {
  RIDER_CLUB_MIN,
  RIDER_PUBLIC_NAME_MIN,
  RiderClub,
  RiderPublicName,
  type ProfileView,
} from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import { Banner, Button, TextField, Toggle, textStyle, useTheme } from '@rkarakulov/ui';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { StyleSheet, Text, View } from 'react-native';
import { z } from 'zod';

import { actionErrorMessage, serverFieldErrors } from '@/features/auth/error-messages';

import { useUpdateProfile } from './queries';

/** Поля формы — те же схемы, что у `UpdateProfileRequest` (без корневого «хотя бы один ключ»: форма шлёт все). */
const ProfileForm = z.object({
  publicName: RiderPublicName,
  club: RiderClub,
  showNameInResults: z.boolean(),
});
type ProfileFormValues = z.input<typeof ProfileForm>;
type ProfileFormOutput = z.output<typeof ProfileForm>;

const FIELDS = ['publicName', 'club', 'showNameInResults'] as const;

const valuesOf = (profile: ProfileView): ProfileFormValues => ({
  publicName: profile.publicName ?? '',
  club: profile.club ?? '',
  showNameInResults: profile.showNameInResults,
});

/** Текст ошибки поля по коду (сообщение zod = код); `min` — предел поля; незнакомый код — «Проверьте значение». */
export function fieldText(
  code: string | undefined,
  min = RIDER_PUBLIC_NAME_MIN,
): string | undefined {
  if (code === undefined) return undefined;
  const key = `field.error.${code}` as MessageKey;
  const text = t(key, { min });
  return text === key ? t('field.error.INVALID') : text;
}

/**
 * Форма «Редактировать профиль» (profile-rider-name, rider-profile): «Как вас показывать в результатах», клуб и
 * согласие на показ. Проверка — схема contracts; ошибки сервера — под полем по коду; сеть, 429 и прочее — баннер над кнопкой; успех — «Сохранено».
 */
export function ProfileFormView({ profile }: { profile: ProfileView }) {
  const theme = useTheme();
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string>();
  const form = useForm<ProfileFormValues, unknown, ProfileFormOutput>({
    resolver: zodResolver(ProfileForm),
    mode: 'onTouched',
    defaultValues: valuesOf(profile),
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setSaved(false);
    setFailure(undefined);
    try {
      const view = await update.mutateAsync(values);
      form.reset(valuesOf(view));
      setSaved(true);
    } catch (error) {
      const fields = serverFieldErrors(error, FIELDS);
      if (fields.length > 0) {
        for (const { field, code } of fields) {
          form.setError(field, { type: 'server', message: code });
        }
        return;
      }
      setFailure(actionErrorMessage(error));
    }
  });

  return (
    <View style={styles.form}>
      <Controller
        control={form.control}
        name="publicName"
        render={({ field }) => (
          <TextField
            label={t('profile.name.label')}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            helper={t('profile.name.hint')}
            autoComplete="off"
            error={fieldText(errors.publicName?.message)}
          />
        )}
      />
      <Controller
        control={form.control}
        name="club"
        render={({ field }) => (
          <TextField
            label={t('profile.club.label')}
            value={field.value ?? ''}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            helper={t('profile.club.hint')}
            autoComplete="off"
            error={fieldText(errors.club?.message, RIDER_CLUB_MIN)}
          />
        )}
      />
      <View style={styles.stack}>
        <Controller
          control={form.control}
          name="showNameInResults"
          render={({ field }) => (
            <Toggle label={t('profile.show.label')} value={field.value} onChange={field.onChange} />
          )}
        />
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('profile.show.hint')}
        </Text>
        {errors.showNameInResults ? (
          <Text style={[textStyle('meta'), { color: theme.status.error }]}>
            {fieldText(errors.showNameInResults.message)}
          </Text>
        ) : null}
      </View>
      <View style={styles.stack}>
        {failure ? <Banner tone="error" message={failure} /> : null}
        {saved && !form.formState.isDirty ? (
          <Banner tone="info" message={t('profile.saved')} />
        ) : null}
        <Button
          label={t('profile.save')}
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
});
