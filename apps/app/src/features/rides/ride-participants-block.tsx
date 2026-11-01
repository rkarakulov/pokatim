import { isNetworkError } from '@pokatim/api-client';
import type {
  RideAttendance,
  RideAttendedGroup,
  RideAttendedRow,
  RideDetail,
  RideParticipants,
} from '@pokatim/contracts';
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
  thanksErrorText,
  type useRideAttendance,
  type useRideParticipants,
  useRideThanks,
} from './participants-queries';
import { RideRiderList } from './ride-rider-list';

type ParticipantsQuery = ReturnType<typeof useRideParticipants>;
type AttendanceMutation = ReturnType<typeof useRideAttendance>;
type ThanksMutation = ReturnType<typeof useRideThanks>;

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

/** «Спасибо за компанию» у строки «Ехали N» (K5): не себе и только публичному; после — текст, без отмены. */
function ThanksRowAction({ row, mutation }: { row: RideAttendedRow; mutation: ThanksMutation }) {
  const theme = useTheme();
  const publicId = row.publicId;
  if (row.self || publicId === null) return null;
  if (row.thanked) {
    return (
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('rides.thanks.done')}
      </Text>
    );
  }
  return (
    <TextAction
      label={t('rides.thanks.one')}
      disabled={mutation.isPending}
      onPress={() => mutation.mutate(publicId)}
    />
  );
}

/** «Поблагодарить всех» над списком (K5, Q1): нет других явившихся — ничего; все поблагодарены — текст. */
function ThanksAll({
  rode,
  allThanked,
  mutation,
}: {
  rode: RideAttendedGroup;
  allThanked: boolean;
  mutation: ThanksMutation;
}) {
  const theme = useTheme();
  // строка зрителя — среди явившихся (публичная строкой, иначе в числе)
  const others = rode.riders.length + rode.hiddenCount - 1;
  if (others <= 0) return null;
  if (allThanked) {
    return (
      <Text style={[textStyle('body'), { color: theme.text.secondary }]}>
        {t('rides.thanks.allDone')}
      </Text>
    );
  }
  return (
    <View style={styles.start}>
      <Button
        label={t('rides.thanks.all')}
        variant="secondary"
        loading={mutation.isPending && mutation.variables === null}
        disabled={mutation.isPending}
        onPress={() => mutation.mutate(null)}
      />
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
  const thanks = useRideThanks(ride.id);
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
          <ThanksAll rode={rode} allThanked={attendance?.allThanked ?? false} mutation={thanks} />
          <RideRiderList
            group={rode}
            trailing={(row) => <ThanksRowAction row={row} mutation={thanks} />}
          />
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
      {rode && thanks.error ? (
        <Banner tone="error" message={thanksErrorText(thanks.error)} />
      ) : null}
      {attendance && (actionable || rode) ? <NameHint /> : null}
    </View>
  );
}

/**
 * Участники и явка карточки райда вошедшему («Свои» P2, K4, K5): список публичных участников или «Ехали N» на
 * прошедшем с явкой (с «Спасибо за компанию» и «Поблагодарить всех», P4), три состояния явки в окне по флагам сервера. Первая загрузка — скелетон на месте блока; ошибка без
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
