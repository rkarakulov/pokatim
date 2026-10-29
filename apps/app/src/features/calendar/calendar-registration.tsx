import type {
  CalendarRegistrationState,
  CalendarStartDetail,
  EventTicketingPublic,
} from '@pokatim/contracts';
import { isNetworkError } from '@pokatim/api-client';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  Banner,
  Button,
  Kicker,
  SkeletonGroup,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { rememberReturnPath } from '@/features/auth/return-path';
import { isSessionPending, isSignedIn, useSessionStore } from '@/features/auth/session-store';
import { WithdrawConfirm } from '@/features/races/participation/withdraw-confirm';
import { ticketErrorMessage } from '@/features/tickets/error-messages';
import { OpenTicketButton } from '@/features/tickets/open-ticket-button';
import {
  useCalendarRegistration,
  useCalendarTicketing,
  useCancelCalendarRegistration,
  useRefreshTicketing,
  useRegisterForCalendarStart,
} from '@/features/tickets/queries';
import { formatDistances } from '@/lib/minsk-format';

import { DistancePicker } from './distance-picker';

type Ticketing = Extract<EventTicketingPublic, { enabled: true }>;

function Block({ children }: { children: ReactNode }) {
  return (
    <View testID="calendar-registration" style={styles.block}>
      <Kicker label={t('calendar.registration.title')} />
      {children}
    </View>
  );
}

function BlockSkeleton() {
  return (
    <View testID="calendar-registration-skeleton">
      <SkeletonGroup>
        <SkeletonText variant="body" lines={2} lastLineWidth="60%" />
      </SkeletonGroup>
    </View>
  );
}

function Meta({ children }: { children: string }) {
  const theme = useTheme();
  return <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{children}</Text>;
}

/** «Осталось мест: N из M» — только при лимите. */
const seatsLine = (ticketing: Ticketing) =>
  ticketing.capacity !== null && ticketing.seatsLeft !== null
    ? t('calendar.registration.seatsLeft', {
        left: String(ticketing.seatsLeft),
        total: String(ticketing.capacity),
      })
    : null;

/** Регистрация закрыта или мест нет — подпись вместо кнопки; открыта — `null`. Решает только сервер. */
const closedReason = (ticketing: Ticketing) =>
  !ticketing.registrationOpen
    ? t('calendar.registration.closed')
    : ticketing.seatsLeft === 0
      ? t('calendar.registration.full')
      : null;

/** Гость: «Зарегистрироваться» → вход с возвратом к старту; регистрация — повторным нажатием после входа. */
function GuestRegistration({ startId, ticketing }: { startId: string; ticketing: Ticketing }) {
  const router = useRouter();
  const closed = closedReason(ticketing);
  if (closed) return <Meta>{closed}</Meta>;
  return (
    <>
      <Button
        label={t('calendar.registration.register')}
        onPress={() => {
          rememberReturnPath(`/calendar/${startId}`);
          router.push('/sign-in');
        }}
      />
      <Meta>{t('calendar.registration.signIn')}</Meta>
    </>
  );
}

/** Нет регистрации: дистанция (обязательна, если их больше одной) и «Зарегистрироваться». */
function RegisterForm({ startId, ticketing }: { startId: string; ticketing: Ticketing }) {
  const register = useRegisterForCalendarStart(startId);
  const distances = ticketing.distancesKm;
  const [picked, setPicked] = useState<number | null>(null);
  const distance = distances.length === 1 ? (distances[0] ?? null) : picked;
  const closed = closedReason(ticketing);
  if (closed) {
    return (
      <>
        <Meta>{closed}</Meta>
        {register.error ? (
          <Banner tone="warning" message={ticketErrorMessage(register.error)} />
        ) : null}
      </>
    );
  }
  const needsDistance = distances.length > 1 && distance === null;
  return (
    <>
      {distances.length > 1 ? (
        <DistancePicker distances={distances} value={picked} onChange={setPicked} />
      ) : null}
      <Button
        label={t('calendar.registration.register')}
        loading={register.isPending}
        disabled={needsDistance}
        onPress={() => register.mutate(distance === null ? {} : { distanceKm: distance })}
      />
      <Meta>{t('calendar.registration.hint')}</Meta>
      {register.error ? (
        <Banner tone="warning" message={ticketErrorMessage(register.error)} />
      ) : null}
    </>
  );
}

/** Есть регистрация: дистанция, «Открыть билет», отмена с подтверждением (только пока регистрация открыта). */
function Registered({
  startId,
  ticketing,
  state,
}: {
  startId: string;
  ticketing: Ticketing;
  state: CalendarRegistrationState;
}) {
  const theme = useTheme();
  const cancel = useCancelCalendarRegistration(startId);
  const [confirming, setConfirming] = useState(false);
  const km = state.registration?.distanceKm ?? null;
  const distance = km === null ? null : formatDistances([km]);
  return (
    <>
      <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>
        {distance
          ? t('calendar.registration.registeredDistance', { distance })
          : t('calendar.registration.registered')}
      </Text>
      <OpenTicketButton ticket={state.ticket} />
      {ticketing.registrationOpen ? (
        confirming ? (
          <WithdrawConfirm
            pending={cancel.isPending}
            onConfirm={() => cancel.mutate(undefined, { onSuccess: () => setConfirming(false) })}
            onClose={() => {
              cancel.reset();
              setConfirming(false);
            }}
            texts={{
              title: t('calendar.registration.cancelTitle'),
              body: t('calendar.registration.cancelBody'),
              confirm: t('calendar.registration.cancelConfirm'),
              keep: t('calendar.registration.keep'),
            }}
          />
        ) : (
          <View style={styles.start}>
            <TextAction
              label={t('calendar.registration.cancel')}
              destructive
              onPress={() => setConfirming(true)}
            />
          </View>
        )
      ) : null}
      {cancel.error ? <Banner tone="warning" message={ticketErrorMessage(cancel.error)} /> : null}
    </>
  );
}

/** Своя регистрация не загрузилась: «Нет соединения» / «Не удалось загрузить» и «Повторить». */
function LoadFailure({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <>
      <Banner
        tone="warning"
        title={t(isNetworkError(error) ? 'state.errorTitle' : 'state.failedTitle')}
        message={t('tickets.error.failed')}
      />
      <View style={styles.start}>
        <TextAction label={t('state.retry')} onPress={retry} />
      </View>
    </>
  );
}

/** Вошедший: своя регистрация (сервер) → форма или «Вы зарегистрированы». */
function SignedInRegistration({ startId, ticketing }: { startId: string; ticketing: Ticketing }) {
  const registration = useCalendarRegistration(startId, true);
  if (registration.data === undefined) {
    if (!registration.isError) return <BlockSkeleton />;
    return <LoadFailure error={registration.error} retry={() => void registration.refetch()} />;
  }
  return (
    <>
      {/* ошибка обновления при показанных данных (§4.12): данные остаются, сверху — баннер с повтором */}
      {registration.isError ? (
        <LoadFailure error={registration.error} retry={() => void registration.refetch()} />
      ) : null}
      {registration.data.registration ? (
        <Registered startId={startId} ticketing={ticketing} state={registration.data} />
      ) : (
        <RegisterForm startId={startId} ticketing={ticketing} />
      )}
    </>
  );
}

/**
 * Регистрация на старт календаря в «Покатим» (event-tickets §5.7, plan-B §6, RC-B7): сводка — публичная, только
 * клиент. Пока грузится — скелетон блока; билеты не включены, ошибка или старый API — прежняя кнопка сайта
 * организатора (`fallback`, деградация без баннера). Включены — блок вместо внешней регистрации: места, гость — вход с
 * возвратом, вошедший — дистанция и регистрация, «Открыть билет», отмена. «Полон» и «закрыта» — только от сервера.
 */
export function CalendarRegistration({
  start,
  fallback,
}: {
  start: CalendarStartDetail;
  fallback: ReactNode;
}) {
  const status = useSessionStore((state) => state.status);
  const signedIn = useSessionStore((state) => isSignedIn(state));
  const ticketing = useCalendarTicketing(start.id, true);
  const refreshTicketing = useRefreshTicketing(start.id);

  if (ticketing.data === undefined) {
    return ticketing.isError ? fallback : <BlockSkeleton />;
  }
  if (!ticketing.data.enabled) return fallback;
  const data = ticketing.data;
  const seats = seatsLine(data);

  return (
    <Block>
      {/* ошибка обновления сводки при показанных данных (§4.12): места остаются, баннер и повтор в обход кэша */}
      {ticketing.isError ? <LoadFailure error={ticketing.error} retry={refreshTicketing} /> : null}
      {seats ? <Meta>{seats}</Meta> : null}
      {isSessionPending(status) ? (
        <BlockSkeleton />
      ) : signedIn ? (
        <SignedInRegistration startId={start.id} ticketing={data} />
      ) : (
        <GuestRegistration startId={start.id} ticketing={data} />
      )}
    </Block>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
