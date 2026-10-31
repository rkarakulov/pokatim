import { isNetworkError } from '@pokatim/api-client';
import type { MyRaceEntry, RaceDetail } from '@pokatim/contracts';
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
import type { UseQueryResult } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { rememberReturnPath } from '@/features/auth/return-path';
import { PushSoftPrompt } from '@/features/notifications/push-soft-prompt';
import { NameConsentPrompt } from '@/features/profile/name-consent-prompt';
import { OpenTicketButton } from '@/features/tickets/open-ticket-button';

import {
  blockReasonText,
  enterBlockReason,
  guestCanSeeEnter,
  offersTierChoice,
  raceActionErrorText,
} from '../participation-format';
import { useEnterRace, useRaceTicket } from '../queries';
import { ShareStoryButton } from '../story/share-story-button';
import { AttemptList } from './attempt-list';
import { EntryActions } from './entry-actions';
import { EntryResult } from './entry-result';
import { TierPicker } from './tier-picker';

function Block({ children }: { children: ReactNode }) {
  return (
    <View testID="race-participation" style={styles.block}>
      {children}
    </View>
  );
}

/** Место блока до ответа: сессия ещё неизвестна или участие загружается — страница не сдвигается рывком. */
function BlockSkeleton() {
  return (
    <View testID="race-participation-skeleton">
      <SkeletonGroup>
        <SkeletonText variant="body" lines={2} lastLineWidth="60%" />
      </SkeletonGroup>
    </View>
  );
}

/**
 * «Участвовать»: гостю — вход с возвратом к гонке (заявка — повторным нажатием, Q13 блока 05), вошедшему — заявка без
 * тела (схема `overall`, старый API; уровень с выбором — `TierPicker`).
 */
function EnterAction({ raceId, signedIn }: { raceId: string; signedIn: boolean }) {
  const theme = useTheme();
  const router = useRouter();
  const enter = useEnterRace(raceId);
  const press = () => {
    if (!signedIn) {
      rememberReturnPath(`/races/${raceId}`);
      router.push('/sign-in');
      return;
    }
    enter.mutate();
  };
  return (
    <Block>
      <Button label={t('races.entry.enter')} loading={enter.isPending} onPress={press} />
      {signedIn ? null : (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('races.entry.signIn')}
        </Text>
      )}
      {enter.error ? <Banner tone="error" message={raceActionErrorText(enter.error)} /> : null}
    </Block>
  );
}

/**
 * Блок «Ваше участие» на карточке гонки (§7.1): только клиент (SSR и неизвестная сессия — скелетон). Гость —
 * «Участвовать» при коридоре и фазе `upcoming | open`; вошедший — по «моему участию» сервера: заявка, причина
 * недоступности, результат, действия и попытки. Локальных правил «можно ли» нет — только `actions` и `result`.
 */
export function RaceParticipation({
  race,
  now,
  entry,
  signedIn,
  sessionPending,
}: {
  race: RaceDetail;
  now: Date | null;
  entry: UseQueryResult<MyRaceEntry | null>;
  signedIn: boolean;
  sessionPending: boolean;
}) {
  const theme = useTheme();
  // билет (event-tickets): только при активной заявке; загрузка и ошибка — без кнопки (билет вторичен, блок не ломаем)
  const activeEntry = signedIn && entry.data?.entry?.status === 'active';
  const ticket = useRaceTicket(race.id, activeEntry);
  // место держим только там, где блок будет и у гостя: на завершённых гонках гость (SSR, ссылки) блока не видит
  if (sessionPending) return guestCanSeeEnter(race) ? <BlockSkeleton /> : null;
  if (!signedIn) {
    return guestCanSeeEnter(race) ? <EnterAction raceId={race.id} signedIn={false} /> : null;
  }

  const data = entry.data;
  if (data === undefined) {
    if (entry.isError) {
      return (
        <Block>
          <Banner
            tone="warning"
            title={t(isNetworkError(entry.error) ? 'state.errorTitle' : 'state.failedTitle')}
            message={t('races.entry.failed')}
          />
          <View style={styles.start}>
            <TextAction label={t('state.retry')} onPress={() => void entry.refetch()} />
          </View>
        </Block>
      );
    }
    return <BlockSkeleton />;
  }
  // старый API без эндпоинта участия (R4)
  if (data === null) return null;

  if (data.entry === null) {
    if (data.actions.canEnter) {
      return offersTierChoice(data) ? (
        <Block>
          <TierPicker entry={data} raceId={race.id} />
        </Block>
      ) : (
        <EnterAction raceId={race.id} signedIn />
      );
    }
    const reason = enterBlockReason(data.actions);
    // отменённая гонка: баннер отмены карточки уже есть (F8)
    if (reason === null || reason === 'cancelled') return null;
    return (
      <Block>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {blockReasonText(reason)}
        </Text>
      </Block>
    );
  }

  if (data.entry.status !== 'active') {
    // `unknown` — как отмена, без текста причины (нейтрально)
    return (
      <Block>
        <Kicker label={t('races.entry.title')} />
        {data.entry.status === 'withdrawn' ? (
          <Banner title={t('races.result.status.withdrawn')} message={t('races.block.withdrawn')} />
        ) : (
          <Banner message={t('races.result.status.withdrawn')} />
        )}
      </Block>
    );
  }

  return (
    <Block>
      <Kicker label={t('races.entry.title')} />
      <EntryResult entry={data} race={race} now={now} />
      {/* после записи на гонку (N5): «Участвовать» ушло — подсказка под итогом участия */}
      <PushSoftPrompt context="race" id={race.id} />
      {/* шит «Как вас показывать в результатах?» после новой записи (name-consent-prompt N1) */}
      <NameConsentPrompt raceId={race.id} />
      <OpenTicketButton ticket={ticket.data} />
      {data.actions.canShareStory ? <ShareStoryButton raceId={race.id} /> : null}
      <EntryActions entry={data} raceId={race.id} now={now} />
      <AttemptList attempts={data.attempts} pendingUploads={data.pendingUploads} now={now} />
    </Block>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
});
