import { Uuid, type AttemptCandidates } from '@pokatim/contracts';
import { motion, size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  EmptyState,
  SkeletonGroup,
  SkeletonListRow,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { formatKm, formatMinskDateTime } from '@/features/devices/format';
import { UploadProgress } from '@/features/devices/upload-progress';
import { useTrackFileUpload } from '@/features/devices/use-track-file-upload';
import { meta } from '@/lib/minsk-format';
import { useMinskClock } from '@/lib/use-minsk-clock';

import { formatElapsed } from './format';
import { raceActionErrorText } from './participation-format';
import { useAddRaceAttempt, useAttemptCandidates } from './queries';

type Candidate = AttemptCandidates['items'][number];

function CandidateRow({
  candidate,
  now,
  busy,
  onPick,
}: {
  candidate: Candidate;
  now: Date;
  busy: boolean;
  onPick: () => void;
}) {
  const theme = useTheme();
  const source = candidate.source === 'unknown' ? 'upload' : candidate.source;
  const when = formatMinskDateTime(candidate.startedAt, now);
  const details = meta([
    t(`tracks.source.${source}`),
    formatKm(candidate.distanceM),
    formatElapsed(candidate.elapsedSec),
  ]);
  const disabled = candidate.attempted || busy;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={meta([
        when,
        details,
        candidate.attempted ? t('races.pick.attempted') : null,
      ])}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPick}
      style={({ pressed }) => [
        styles.row,
        { borderTopColor: theme.border.subtle, opacity: pressed ? motion.pressedOpacity : 1 },
      ]}
    >
      <Text
        style={[
          textStyle('titleSm'),
          { color: candidate.attempted ? theme.text.disabled : theme.text.primary },
        ]}
      >
        {when}
      </Text>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{details}</Text>
      {candidate.attempted ? (
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('races.pick.attempted')}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * «Выбрать свой заезд» (`/races/pick/<id>`, только вошедшим): свои заезды в окне гонки; уже добавленные выключены.
 * Выбор — попытка `{ activityId }` (вердикт — сервер), затем назад к карточке гонки; заездов нет — «Загрузить заезд»
 * (файл → попытка `{ uploadId }` → назад). Невалидный id — «Гонка не найдена» без запроса.
 */
export function RacePickScreen({ id }: { id: string }) {
  const theme = useTheme();
  const router = useRouter();
  const valid = Uuid.safeParse(id).success;
  const candidates = useAttemptCandidates(id, valid);
  const addAttempt = useAddRaceAttempt(id);
  const now = useMinskClock([candidates.dataUpdatedAt]);
  const title = t('races.entry.pickRide');

  const backToRace = () => {
    if (router.canGoBack()) router.back();
    else router.replace(`/races/${id}`);
  };
  const pickActivity = (activityId: string) =>
    addAttempt.mutate({ activityId }, { onSuccess: backToRace });
  // пусто — «Загрузить заезд» тем же путём, что на карточке гонки: файл, затем попытка `{ uploadId }` (B8 смоука dev)
  const upload = useTrackFileUpload({
    onUploaded: (sent) => addAttempt.mutate({ uploadId: sent.id }, { onSuccess: backToRace }),
  });
  const chooseFile = () => {
    addAttempt.reset();
    void upload.choose();
  };

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${title} — ${t('app.name')}`} />
      <DetailHeader title={title} fallback={valid ? `/races/${id}` : '/races'} />
      <ScrollView contentContainerStyle={styles.content}>
        {valid ? (
          <View style={styles.list}>
            {upload.state.phase === 'uploading' ? (
              <UploadProgress
                name={upload.state.name}
                progress={upload.state.progress}
                onCancel={upload.cancel}
              />
            ) : null}
            {upload.state.phase === 'failed' ? (
              <Banner tone="error" message={upload.state.message} />
            ) : null}
            {addAttempt.error ? (
              <Banner tone="error" message={raceActionErrorText(addAttempt.error)} />
            ) : null}
            <AsyncContent
              query={candidates}
              skeleton={
                <SkeletonGroup>
                  <SkeletonListRow />
                  <SkeletonListRow />
                  <SkeletonListRow />
                </SkeletonGroup>
              }
              empty={{
                when: (data) => data.items.length === 0,
                render: () => (
                  <EmptyState
                    title={t('races.pick.empty')}
                    message={t('races.pick.emptyHint')}
                    {...(upload.state.phase === 'uploading' || addAttempt.isPending
                      ? {}
                      : { action: { label: t('races.entry.upload'), onPress: chooseFile } })}
                  />
                ),
              }}
            >
              {(data) => (
                <View>
                  {data.items.map((candidate) => (
                    <CandidateRow
                      key={candidate.activityId}
                      candidate={candidate}
                      now={now}
                      busy={addAttempt.isPending}
                      onPick={() => pickActivity(candidate.activityId)}
                    />
                  ))}
                </View>
              )}
            </AsyncContent>
          </View>
        ) : (
          <EmptyState
            title={t('races.detail.notFound')}
            action={{ label: t('races.detail.allRaces'), onPress: () => router.navigate('/races') }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6 },
  list: { gap: space.s3 },
  row: { gap: space.s1, paddingVertical: space.s3, borderTopWidth: stroke.hairline },
});
