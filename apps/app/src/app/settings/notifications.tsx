import type {
  EventNotificationSettingsView,
  NotificationSettings,
  RouteNotificationSettingsView,
} from '@pokatim/contracts';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Chip,
  SkeletonGroup,
  SkeletonListRow,
  TextAction,
  Toggle,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DocumentTitle } from '@/components/document-title';
import { useSettingsShell } from '@/features/devices/settings-shell';
import { usePushSupported } from '@/features/notifications/push';
import {
  PushPermissionRow,
  usePushPermission,
  type PushPermissionControl,
} from '@/features/notifications/push-permission-row';
import {
  isSettingsResourceMissing,
  useEventNotificationSettings,
  useNotificationSettings,
  useRouteNotificationSettings,
  useUpdateEventNotificationSettings,
  useUpdateNotificationSettings,
  useUpdateRouteNotificationSettings,
} from '@/features/notifications/queries';

const DOCUMENT_TITLE = `${t('notifications.settings.title')} — ${t('app.name')}`;
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

type PushGroup = keyof NotificationSettings['push'];
type EmailGroup = keyof NotificationSettings['email'];

const ALL_GROUPS: readonly { id: PushGroup; email: EmailGroup | null }[] = [
  { id: 'races', email: null },
  { id: 'disputes', email: 'disputes' },
  { id: 'rides', email: 'rides' },
];
/** Без push (браузер без Web Push, iOS вне установленной PWA, сервер без VAPID) — только группы с письмами. */
const EMAIL_GROUPS = ALL_GROUPS.filter((group) => group.email !== null);

const SKELETON = (
  <SkeletonGroup>
    <SkeletonListRow />
    <SkeletonListRow />
    <SkeletonListRow />
  </SkeletonGroup>
);

/**
 * «Настройки уведомлений» (N4, N6; вход — из центра и из «Профиля»): push по трём группам, e-mail — только у
 * «Споры» и «Райды» (события N2), тихие часы (вкл/выкл, начало и конец по часам Минска). Каждое изменение сразу
 * сохраняет полный объект (`PUT`); пока идёт запрос, видно новое значение, а тумблеры и часы недоступны (§4.12: два
 * полных `PUT` подряд затёрли бы друг друга); ошибка — баннер и прежнее значение. Платформа без push (`usePushSupported`:
 * web — Web Push браузера и сервера, ADR-0022; до проверки — скелетон) — только письма: без push-тумблеров, тихих часов
 * (они откладывают только push) и группы без писем; push-значения не меняются. Строка разрешения и push-тумблеры
 * делят одно состояние разрешения: включение тумблера, пока системный запрос не показывали, сначала вызывает его (в том
 * же нажатии), включённый тумблер без разрешения или подписки подписан «не придут на это устройство». Группа
 * «Мероприятия» (напоминания о событиях с билетом, PR D) — отдельный подресурс со своим сохранением (RC-D1); старый API
 * (404) — группы нет. «Маршруты» (решения по заявке своего маршрута) — так же, после «Райдов», только push: без push
 * блока нет и запроса нет; после сохранения основных настроек перечитывается (без своего тумблера сервер отдаёт
 * значение «Райдов»).
 */
export default function NotificationSettingsScreen() {
  const shell = useSettingsShell();
  return shell ?? <SettingsContent />;
}

function SettingsContent() {
  const theme = useTheme();
  const router = useRouter();
  const settings = useNotificationSettings();
  const pushSupported = usePushSupported();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/notifications'));

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={DOCUMENT_TITLE} />
      <ScrollView testID="notification-settings-screen" contentContainerStyle={styles.content}>
        <View style={styles.start}>
          <TextAction label={t('notifications.back')} onPress={back} />
        </View>
        <Text
          accessibilityRole="header"
          style={[textStyle('displayTitle'), { color: theme.text.primary }]}
        >
          {t('notifications.settings.title')}
        </Text>
        {pushSupported === null ? (
          SKELETON
        ) : (
          <>
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {t(
                pushSupported ? 'notifications.settings.lead' : 'notifications.settings.leadEmail',
              )}
            </Text>
            {pushSupported ? (
              <PushSettings settings={settings} />
            ) : (
              <AsyncContent query={settings} skeleton={SKELETON}>
                {(saved) => <SettingsForm saved={saved} push={false} />}
              </AsyncContent>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Платформа с push: строка разрешения и форма — с одним состоянием разрешения устройства. */
function PushSettings({ settings }: { settings: ReturnType<typeof useNotificationSettings> }) {
  const control = usePushPermission();
  return (
    <>
      <PushPermissionRow control={control} />
      <AsyncContent query={settings} skeleton={SKELETON}>
        {(saved) => <SettingsForm saved={saved} push control={control} />}
      </AsyncContent>
    </>
  );
}

function SettingsForm({
  saved,
  push,
  control,
}: {
  saved: NotificationSettings;
  push: boolean;
  control?: PushPermissionControl;
}) {
  const theme = useTheme();
  const update = useUpdateNotificationSettings();
  // пока запрос идёт — новое значение; ошибка — прежнее (кеш) и баннер
  const value = update.isPending && update.variables ? update.variables : saved;
  const busy = update.isPending;
  const save = (next: NotificationSettings) => {
    if (!busy) update.mutate(next);
  };
  const quiet = value.quietHours;
  const setQuiet = (patch: Partial<NotificationSettings['quietHours']>) =>
    save({ ...value, quietHours: { ...quiet, ...patch } });

  const groupTitle = (text: string) => (
    <Text accessibilityRole="header" style={[textStyle('label'), { color: theme.text.secondary }]}>
      {text}
    </Text>
  );

  return (
    <View style={styles.form}>
      {update.isError ? (
        <Banner tone="error" message={t('notifications.settings.saveFailed')} />
      ) : null}
      {(push ? ALL_GROUPS : EMAIL_GROUPS).map((group) => (
        <View key={group.id} style={[styles.group, { borderTopColor: theme.border.subtle }]}>
          {groupTitle(t(`notifications.settings.group.${group.id}` as MessageKey))}
          {push ? (
            <>
              <Toggle
                label={t('notifications.settings.push')}
                value={value.push[group.id]}
                disabled={busy}
                onChange={(on) => {
                  // системный запрос — первым, в том же нажатии (Safari); сохранение не ждёт ответа
                  if (on && !busy) void control?.enableFromToggle();
                  save({ ...value, push: { ...value.push, [group.id]: on } });
                }}
              />
              {value.push[group.id] && control?.delivers === false ? (
                <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
                  {t('notifications.settings.pushBlocked')}
                </Text>
              ) : null}
            </>
          ) : null}
          {group.email ? (
            <>
              <Toggle
                label={t('notifications.settings.email')}
                value={value.email[group.email]}
                disabled={busy}
                onChange={(on) =>
                  save({ ...value, email: { ...value.email, [group.email as EmailGroup]: on } })
                }
              />
              <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
                {t(`notifications.settings.emailHint.${group.email}` as MessageKey)}
              </Text>
            </>
          ) : null}
        </View>
      ))}
      <RoutesGroup push={push} control={control} />
      <EventsGroup push={push} control={control} />
      {push ? (
        <View style={[styles.group, { borderTopColor: theme.border.subtle }]}>
          {groupTitle(t('notifications.settings.quiet.title'))}
          <Toggle
            label={t('notifications.settings.quiet.toggle')}
            value={quiet.enabled}
            disabled={busy}
            onChange={(enabled) => setQuiet({ enabled })}
          />
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('notifications.settings.quiet.hint')}
          </Text>
          {quiet.enabled ? (
            <>
              <HourPicker
                label={t('notifications.settings.quiet.start')}
                selected={quiet.startHour}
                excluded={quiet.endHour}
                disabled={busy}
                onSelect={(startHour) => setQuiet({ startHour })}
              />
              <HourPicker
                label={t('notifications.settings.quiet.end')}
                selected={quiet.endHour}
                excluded={quiet.startHour}
                disabled={busy}
                onSelect={(endHour) => setQuiet({ endHour })}
              />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * «Мероприятия»: push (при доступном push) и e-mail напоминаний о событиях с билетом. Своё сохранение подресурса:
 * пока идёт запрос — новое значение, тумблеры недоступны; ошибка — баннер и прежнее значение. Загрузка — строка-
 * скелетон, `404` (старый API) — группы нет, прочие ошибки — «Нет соединения» с повтором (`AsyncContent`).
 */
function EventsGroup({ push, control }: { push: boolean; control?: PushPermissionControl }) {
  const theme = useTheme();
  const query = useEventNotificationSettings();
  const update = useUpdateEventNotificationSettings();
  if (isSettingsResourceMissing(query.error)) return null;
  return (
    <View style={[styles.group, { borderTopColor: theme.border.subtle }]}>
      <Text
        accessibilityRole="header"
        style={[textStyle('label'), { color: theme.text.secondary }]}
      >
        {t('notifications.settings.group.events')}
      </Text>
      <AsyncContent query={query} skeleton={<SkeletonListRow />}>
        {(saved) => {
          const value: EventNotificationSettingsView =
            update.isPending && update.variables ? update.variables : saved;
          const busy = update.isPending;
          const save = (next: EventNotificationSettingsView) => {
            if (!busy) update.mutate(next);
          };
          return (
            <>
              {update.isError ? (
                <Banner tone="error" message={t('notifications.settings.saveFailed')} />
              ) : null}
              {push ? (
                <>
                  <Toggle
                    label={t('notifications.settings.push')}
                    value={value.push}
                    disabled={busy}
                    onChange={(on) => {
                      // как у остальных групп: системный запрос — первым, в том же нажатии
                      if (on && !busy) void control?.enableFromToggle();
                      save({ ...value, push: on });
                    }}
                  />
                  {value.push && control?.delivers === false ? (
                    <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
                      {t('notifications.settings.pushBlocked')}
                    </Text>
                  ) : null}
                </>
              ) : null}
              <Toggle
                label={t('notifications.settings.email')}
                value={value.email}
                disabled={busy}
                onChange={(on) => save({ ...value, email: on })}
              />
              <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
                {t('notifications.settings.emailHint.events')}
              </Text>
            </>
          );
        }}
      </AsyncContent>
    </View>
  );
}

/**
 * «Маршруты»: только push (писем у группы нет). Своё сохранение подресурса, как у «Мероприятий»: пока идёт запрос —
 * новое значение, тумблер недоступен; ошибка — баннер и прежнее значение; `404` (старый API) и платформа без push —
 * блока нет (без push и запроса нет).
 */
function RoutesGroup({ push, control }: { push: boolean; control?: PushPermissionControl }) {
  const theme = useTheme();
  const query = useRouteNotificationSettings({ enabled: push });
  const update = useUpdateRouteNotificationSettings();
  if (!push || isSettingsResourceMissing(query.error)) return null;
  return (
    <View style={[styles.group, { borderTopColor: theme.border.subtle }]}>
      <Text
        accessibilityRole="header"
        style={[textStyle('label'), { color: theme.text.secondary }]}
      >
        {t('notifications.settings.group.routes')}
      </Text>
      <AsyncContent query={query} skeleton={<SkeletonListRow />}>
        {(saved) => {
          const value: RouteNotificationSettingsView =
            update.isPending && update.variables ? update.variables : saved;
          const busy = update.isPending;
          return (
            <>
              {update.isError ? (
                <Banner tone="error" message={t('notifications.settings.saveFailed')} />
              ) : null}
              <Toggle
                label={t('notifications.settings.push')}
                value={value.push}
                disabled={busy}
                onChange={(on) => {
                  // как у остальных групп: системный запрос — первым, в том же нажатии
                  if (on && !busy) void control?.enableFromToggle();
                  if (!busy) update.mutate({ push: on });
                }}
              />
              {value.push && control?.delivers === false ? (
                <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
                  {t('notifications.settings.pushBlocked')}
                </Text>
              ) : null}
            </>
          );
        }}
      </AsyncContent>
    </View>
  );
}

/**
 * Час начала или конца — ряд чипов 0–23; час другого края пропущен (начало ≠ концу). `disabled` — на время
 * сохранения: у `Chip` базы нет `disabled`, поэтому ряд недоступен целиком (`aria-disabled`, без нажатий).
 */
function HourPicker({
  label,
  selected,
  excluded,
  disabled,
  onSelect,
}: {
  label: string;
  selected: number;
  excluded: number;
  disabled: boolean;
  onSelect: (hour: number) => void;
}) {
  const theme = useTheme();
  return (
    <View style={styles.hours}>
      <Text
        accessibilityRole="header"
        style={[textStyle('label'), { color: theme.text.secondary }]}
      >
        {label}
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View aria-disabled={disabled} style={[styles.chips, disabled ? styles.disabled : null]}>
          {HOURS.filter((hour) => hour !== excluded).map((hour) => (
            <Chip
              key={hour}
              label={t('notifications.settings.quiet.hour', { hour })}
              selected={hour === selected}
              onPress={() => {
                if (!disabled && hour !== selected) onSelect(hour);
              }}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s3 },
  start: { alignItems: 'flex-start' },
  form: { gap: space.s3 },
  group: { gap: space.s2, paddingTop: space.s4, borderTopWidth: stroke.hairline },
  hours: { gap: space.s2 },
  chips: { flexDirection: 'row', gap: space.s2 },
  disabled: { pointerEvents: 'none' },
});
