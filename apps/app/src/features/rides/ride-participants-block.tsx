import { isNetworkError } from '@pokatim/api-client';
import type { RideAttendance, RideDetail, RideParticipants } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  SkeletonText,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useProfile } from '@/features/profile/queries';

import {
  attendanceErrorText,
  type AttendanceAction,
  type useRideAttendance,
  type useRideParticipants,
} from './participants-queries';
import { RideRiderList } from './ride-rider-list';

type ParticipantsQuery = ReturnType<typeof useRideParticipants>;
type AttendanceMutation = ReturnType<typeof useRideAttendance>;

/** Блок явки по флагам сервера (K5, RC-3, RC-10): только прошедший райд и участник с известным состоянием. */
function attendanceOf(ride: RideDetail, data: RideParticipants): RideAttendance | null {
  if (ride.phase !== 'past' || data.attendance === null) return null;
  return data.attendance.state === 'unknown' ? null : data.attendance;
}

/** «Добавьте имя — свои увидят вас» (K3, Q1): у зрителя есть блок явки, а свой профиль не публичный. */
function NameHint() {
  const theme = useTheme();
  const router = useRouter();
  const profile = useProfile();
  if (!profile.data || (profile.data.publicName !== null && profile.data.showNameInResults)) {
    return null;
  }
  return (
    <View style={styles.stack}>
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('social.nameHint.title')}
      </Text>
      <View style={styles.start}>
        <TextAction
          label={t('social.nameHint.action')}
          onPress={() => router.push('/settings/profile')}
        />
      </View>
    </View>
  );
}

function AttendanceActions({
  attendance,
  mutation,
}: {
  attendance: RideAttendance;
  mutation: AttendanceMutation;
}) {
  const theme = useTheme();
  const pending = (action: AttendanceAction) => mutation.isPending && mutation.variables === action;
  const markButton = attendance.canMark ? (
    <Button
      label={t('rides.attendance.mark')}
      loading={pending('mark')}
      disabled={mutation.isPending}
      onPress={() => mutation.mutate('mark')}
    />
  ) : null;
  const declineLink = attendance.canDecline ? (
    <View style={styles.start}>
      <TextAction
        label={t('rides.attendance.decline')}
        disabled={mutation.isPending}
        onPress={() => mutation.mutate('decline')}
      />
    </View>
  ) : null;
  return (
    <View style={styles.stack}>
      {attendance.state === 'none' && attendance.canMark ? (
        <Banner message={t('rides.attendance.pastTitle')} />
      ) : null}
      {attendance.state === 'declined' && attendance.canMark ? (
        <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
          {t('rides.attendance.declined')}
        </Text>
      ) : null}
      {attendance.state === 'attended' ? null : markButton}
      {attendance.state === 'declined' ? null : declineLink}
    </View>
  );
}

function ParticipantsContent({
  ride,
  data,
  mutation,
}: {
  ride: RideDetail;
  data: RideParticipants;
  mutation: AttendanceMutation;
}) {
  const theme = useTheme();
  const attendance = attendanceOf(ride, data);
  const rode = attendance?.state === 'attended' ? attendance.attended : null;
  // в окне явки — кнопки; после окна — только «Ехали N» при явке (K5)
  const actionable = attendance !== null && (attendance.canMark || attendance.canDecline);
  return (
    <View style={styles.block}>
      {rode ? (
        <View style={styles.stack}>
          <Text
            accessibilityRole="header"
            style={[textStyle('label'), { color: theme.text.primary }]}
          >
            {t('rides.attendance.rode', { count: rode.riders.length + rode.hiddenCount })}
          </Text>
          <RideRiderList group={rode} />
        </View>
      ) : (
        <RideRiderList group={data} />
      )}
      {attendance && actionable ? (
        <AttendanceActions attendance={attendance} mutation={mutation} />
      ) : null}
      {/* вне `actionable`: после 409 перечитанные флаги закрывают действия, а причина отказа остаётся видна */}
      {attendance && mutation.error ? (
        <Banner tone="error" message={attendanceErrorText(mutation.error)} />
      ) : null}
      {attendance && (actionable || rode) ? <NameHint /> : null}
    </View>
  );
}

/**
 * Участники и явка карточки райда вошедшему («Свои» P2, K4, K5): список публичных участников или «Ехали N» на
 * прошедшем с явкой, три состояния явки в окне по флагам сервера. Первая загрузка — скелетон на месте блока; ошибка без
 * данных — баннер с повтором, остальная карточка видна (AGENTS §4.12).
 */
export function RideParticipantsBlock({
  ride,
  query,
  attendance,
}: {
  ride: RideDetail;
  query: ParticipantsQuery;
  attendance: AttendanceMutation;
}) {
  if (query.isError && query.data === undefined) {
    return (
      <View style={styles.stack}>
        <Banner
          tone="warning"
          title={t(isNetworkError(query.error) ? 'state.errorTitle' : 'state.failedTitle')}
          message={t('rides.participants.failed')}
        />
        <View style={styles.start}>
          <TextAction label={t('state.retry')} onPress={() => void query.refetch()} />
        </View>
      </View>
    );
  }
  return (
    <AsyncContent
      query={query}
      skeleton={
        <View testID="ride-participants-skeleton">
          <SkeletonText variant="body" lines={3} lastLineWidth="60%" />
        </View>
      }
    >
      {(data) => <ParticipantsContent ride={ride} data={data} mutation={attendance} />}
    </AsyncContent>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s4 },
  stack: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
