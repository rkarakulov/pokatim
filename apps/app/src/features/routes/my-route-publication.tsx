import type { MyRoute } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, Pill, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { domainLabel } from '@/lib/minsk-format';

import { routePublicationErrorMessage } from './error-messages';
import { myRoutePublicationStatus } from './my-route-format';
import { useUnpublishMyRoute } from './my-routes-queries';

/** Экран заявки в каталог своего маршрута. */
export const myRoutePublishPath = (id: string) => `/routes/mine/publish/${encodeURIComponent(id)}`;
const catalogPath = (id: string) => `/routes/${encodeURIComponent(id)}`;

/**
 * «Отозвать заявку» / «Снять с публикации» с подтверждением (как «Удалить»): ответ сервера — в карточку и список,
 * отказ — баннер с причиной.
 */
function UnpublishAction({
  route,
  label,
  confirm,
}: {
  route: MyRoute;
  label: string;
  confirm: string;
}) {
  const theme = useTheme();
  const unpublish = useUnpublishMyRoute(route.id);
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <View style={styles.start}>
        <TextAction label={label} onPress={() => setConfirming(true)} />
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <Text style={[textStyle('body'), { color: theme.text.primary }]}>{confirm}</Text>
      {unpublish.isError ? (
        <Banner
          tone="error"
          title={t('routes.publication.actionFailed')}
          message={routePublicationErrorMessage(unpublish.error, 'auth.error.unknown')}
        />
      ) : null}
      <Button
        label={label}
        variant="secondary"
        loading={unpublish.isPending}
        onPress={() => unpublish.mutate(undefined, { onSuccess: () => setConfirming(false) })}
      />
      <View style={styles.start}>
        <TextAction
          label={t('routes.publication.cancel')}
          disabled={unpublish.isPending}
          onPress={() => {
            setConfirming(false);
            unpublish.reset();
          }}
        />
      </View>
    </View>
  );
}

/**
 * Блок «Публикация в каталоге» карточки своего маршрута (routes-06, A1): статус заявки и действия по нему —
 * «На проверке» → «Отозвать заявку»; «В каталоге» → «Открыть в каталоге», «Снять с публикации»; «Отклонён» — причина
 * и комментарий модератора; «Скрыт модератором» — пояснение без действий. «Опубликовать» — только по `canPublish`
 * сервера; отклонённый без подач — «использованы все 3 подачи». Не готовый маршрут — блока нет.
 */
export function MyRoutePublication({ route }: { route: MyRoute }) {
  const theme = useTheme();
  const router = useRouter();
  if (route.status !== 'ready') return null;
  const { publication } = route;
  const status = myRoutePublicationStatus(route);
  const rejection = publication?.status === 'rejected' ? publication.rejection : null;
  const rejectionReason = rejection
    ? domainLabel('domain.routeRejectionReason', rejection.reason)
    : null;
  if (!status && !route.canPublish) return null;
  const secondary = { color: theme.text.secondary };

  return (
    <View testID="my-route-publication" style={styles.stack}>
      <Text accessibilityRole="header" style={[textStyle('label'), secondary]}>
        {t('routes.publication.title')}
      </Text>
      {status ? (
        <View style={styles.start}>
          <Pill label={status.label} tone={status.tone} />
        </View>
      ) : null}
      {publication?.status === 'pending' ? (
        <>
          <Text style={[textStyle('body'), secondary]}>{t('routes.publication.pendingHint')}</Text>
          <UnpublishAction
            route={route}
            label={t('routes.publication.withdraw')}
            confirm={t('routes.publication.withdrawConfirm')}
          />
        </>
      ) : null}
      {publication?.status === 'approved' ? (
        <>
          <View style={styles.start}>
            <TextAction
              label={t('routes.publication.openInCatalog')}
              onPress={() => router.push(catalogPath(route.id))}
            />
          </View>
          <UnpublishAction
            route={route}
            label={t('routes.publication.unpublish')}
            confirm={t('routes.publication.unpublishConfirm')}
          />
        </>
      ) : null}
      {rejection ? (
        <>
          {rejectionReason ? (
            <Text style={[textStyle('body'), { color: theme.text.primary }]}>
              {t('routes.publication.rejectedTitle', { reason: rejectionReason })}
            </Text>
          ) : null}
          {rejection.comment ? (
            <Text style={[textStyle('body'), secondary]}>
              {t('routes.publication.rejectedComment', { comment: rejection.comment })}
            </Text>
          ) : null}
        </>
      ) : null}
      {publication?.status === 'hidden' ? (
        <Text style={[textStyle('body'), secondary]}>{t('routes.publication.hiddenHint')}</Text>
      ) : null}
      {route.canPublish ? (
        <Button
          label={t('routes.publication.publish')}
          variant="secondary"
          onPress={() => router.push(myRoutePublishPath(route.id))}
        />
      ) : publication?.status === 'rejected' ? (
        <Text style={[textStyle('body'), secondary]}>
          {t('routes.publication.noSubmissionsLeft')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
