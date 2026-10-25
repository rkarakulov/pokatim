import { zodResolver } from '@hookform/resolvers/zod';
import { isNetworkError } from '@pokatim/api-client';
import { RIDE_REASONS, type RideReason, SubmitOnboardingSurveyRequest } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { Banner, Button, Checkbox } from '@rkarakulov/ui';
import { Controller, useForm, useWatch } from 'react-hook-form';
import type { z } from 'zod';

import { DocumentTitle } from '@/components/document-title';
import { AuthActions, AuthScreen, AuthStack } from '@/features/auth/auth-screen';
import { actionErrorMessage } from '@/features/auth/error-messages';
import { useSubmitSurvey } from '@/features/onboarding/queries';

type SurveyInput = z.input<typeof SubmitOnboardingSurveyRequest>;
type SurveyOutput = z.output<typeof SubmitOnboardingSurveyRequest>;

const DOCUMENT_TITLE = `${t('onboarding.survey.title')} — ${t('app.name')}`;

/** Ошибка сохранения: сеть — «Нет соединения», прочее — «Не удалось сохранить». */
const saveErrorMessage = (error: unknown) =>
  isNetworkError(error) ? actionErrorMessage(error) : t('onboarding.survey.saveFailed');

/**
 * «Что вас привело?» — обязательный опрос после первого входа: несколько вариантов, минимум один. Ответ — на сервер
 * (`PUT /v1/profile/onboarding/survey`); успех — шаг геопозиции или Главная (гард). Ошибка — баннер, повтор —
 * той же кнопкой.
 */
export default function SurveyScreen() {
  const submit = useSubmitSurvey();
  const { control, handleSubmit } = useForm<SurveyInput, unknown, SurveyOutput>({
    resolver: zodResolver(SubmitOnboardingSurveyRequest),
    defaultValues: { reasons: [] },
  });
  const chosen = useWatch({ control, name: 'reasons' });

  const onSubmit = handleSubmit(async (values) => {
    await submit.mutateAsync(values).catch(() => undefined);
  });

  return (
    <AuthScreen
      kicker={t('onboarding.kicker')}
      title={t('onboarding.survey.title')}
      lead={t('onboarding.survey.lead')}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <Controller
        control={control}
        name="reasons"
        render={({ field }) => {
          const selected = new Set<RideReason>(field.value);
          const toggle = (reason: RideReason, checked: boolean) => {
            // порядок ответа — порядок экрана (enum), а не порядок нажатий
            field.onChange(RIDE_REASONS.filter((r) => (r === reason ? checked : selected.has(r))));
          };
          return (
            <AuthStack>
              {RIDE_REASONS.map((reason) => (
                <Checkbox
                  key={reason}
                  label={t(`onboarding.reason.${reason}`)}
                  checked={selected.has(reason)}
                  onChange={(checked) => toggle(reason, checked)}
                  disabled={submit.isPending}
                />
              ))}
            </AuthStack>
          );
        }}
      />
      <AuthActions>
        {submit.error ? <Banner tone="error" message={saveErrorMessage(submit.error)} /> : null}
        <Button
          label={t('onboarding.survey.submit')}
          onPress={() => void onSubmit()}
          disabled={chosen.length === 0}
          loading={submit.isPending}
        />
      </AuthActions>
    </AuthScreen>
  );
}
