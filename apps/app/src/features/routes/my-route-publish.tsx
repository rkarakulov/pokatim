import { apiErrorOf } from '@pokatim/api-client';
import {
  isCityCode,
  SURFACES,
  SubmitRoutePublicationInput,
  Uuid,
  type CityCode,
  type MyRoute,
  type Surface,
} from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  Checkbox,
  Chip,
  EmptyState,
  SkeletonHeroCard,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { CityPicker } from '@/features/rides/ride-form';
import { toggle } from '@/lib/filter-chips';
import { domainLabel } from '@/lib/minsk-format';

import { routePublicationErrorMessage } from './error-messages';
import { MY_ROUTES_HREF } from './my-route-detail';
import { myRoutePath } from './my-route-feed';
import { useMyRoute, useSubmitMyRoutePublication } from './my-routes-queries';

/** Назад к карточке своего маршрута: история есть — назад, нет (ссылка) — заменить на карточку. */
function useBackToRoute(id: string) {
  const router = useRouter();
  return () => {
    if (router.canGoBack()) router.back();
    else router.replace(myRoutePath(id));
  };
}

/** Прошлая заявка (отклонённая) — город и покрытие подставляются; незнакомые коды нового API — пропускаются. */
function initialCity(route: MyRoute): CityCode | undefined {
  const city = route.publication?.city;
  return city !== undefined && isCityCode(city) ? city : undefined;
}
function initialSurfaces(route: MyRoute): Surface[] {
  return (route.publication?.surfaces ?? []).filter((value): value is Surface =>
    (SURFACES as readonly string[]).includes(value),
  );
}

/**
 * Форма заявки (A2): город старта (справочник), покрытие (1–2), «Подписать моим именем» (U3), предупреждение «Линия,
 * старт и финиш станут видны всем». «Отправить на проверку» — когда форма проходит схему контракта; успех — назад к
 * карточке (там статус «На проверке»); отказ — баннер (лимиты U8, состояние, 429, сеть).
 */
function PublishForm({ route }: { route: MyRoute }) {
  const theme = useTheme();
  const back = useBackToRoute(route.id);
  const submit = useSubmitMyRoutePublication(route.id);
  const [city, setCity] = useState<CityCode | undefined>(() => initialCity(route));
  const [surfaces, setSurfaces] = useState<Surface[]>(() => initialSurfaces(route));
  const [showAuthorName, setShowAuthorName] = useState(false);
  const parsed = SubmitRoutePublicationInput.safeParse({ city, surfaces, showAuthorName });

  return (
    <View style={styles.form}>
      <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{route.title}</Text>
      <Banner tone="warning" message={t('routes.publish.warning')} />
      <CityPicker
        label={t('routes.publish.city')}
        value={city}
        onChange={setCity}
        error={undefined}
      />
      <View style={styles.field}>
        <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
          {t('routes.publish.surfaces')}
        </Text>
        <View style={styles.chips}>
          {SURFACES.map((value) => (
            <Chip
              key={value}
              label={domainLabel('domain.surface', value) ?? value}
              selected={surfaces.includes(value)}
              onPress={() => setSurfaces(toggle(surfaces, value))}
            />
          ))}
        </View>
      </View>
      <View>
        <Checkbox
          label={t('routes.publish.showName')}
          checked={showAuthorName}
          onChange={setShowAuthorName}
        />
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('routes.publish.showNameHint')}
        </Text>
      </View>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('routes.publish.hint')}
      </Text>
      {submit.isError ? (
        <Banner
          tone="error"
          title={t('routes.publish.failed')}
          message={routePublicationErrorMessage(submit.error, 'auth.error.unknown')}
        />
      ) : null}
      <Button
        label={t('routes.publish.submit')}
        loading={submit.isPending}
        disabled={!parsed.success || submit.isPending}
        onPress={() => {
          if (parsed.success) submit.mutate(parsed.data, { onSuccess: back });
        }}
      />
      <View style={styles.start}>
        <TextAction label={t('routes.publish.back')} onPress={back} disabled={submit.isPending} />
      </View>
    </View>
  );
}

/** Подать нельзя (сервер: `canPublish: false`) — пояснение и «К маршруту». */
function Unavailable({ id }: { id: string }) {
  const theme = useTheme();
  const back = useBackToRoute(id);
  return (
    <View style={styles.form}>
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('routes.publish.unavailable')}
      </Text>
      <View style={styles.start}>
        <TextAction label={t('routes.publish.back')} onPress={back} />
      </View>
    </View>
  );
}

/**
 * «Опубликовать в каталоге» (`/routes/mine/publish/<id>`, routes-06) — внутри `Stack.Protected` (гость — на вход).
 * Право подать — только `canPublish` сервера; невалидный id и 404 — «Маршрут недоступен»; загрузка и ошибки —
 * `AsyncContent`.
 */
export function MyRoutePublishScreen({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const route = useMyRoute(id, valid);
  const notFound = !valid || apiErrorOf(route.error)?.code === 'NOT_FOUND';

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${t('routes.publish.title')} — ${t('app.name')}`} />
      <DetailHeader
        title={t('routes.publish.title')}
        fallback={valid ? myRoutePath(id) : MY_ROUTES_HREF}
      />
      <ScrollView
        testID="my-route-publish"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {notFound ? (
          <EmptyState
            title={t('routes.mine.detail.notFound')}
            action={{
              label: t('routes.mine.detail.back'),
              onPress: () => router.navigate(MY_ROUTES_HREF),
            }}
          />
        ) : (
          <AsyncContent query={route} skeleton={<SkeletonHeroCard />}>
            {(data: MyRoute) =>
              data.canPublish ? <PublishForm route={data} /> : <Unavailable id={data.id} />
            }
          </AsyncContent>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  form: { gap: space.s4 },
  field: { gap: space.s2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
