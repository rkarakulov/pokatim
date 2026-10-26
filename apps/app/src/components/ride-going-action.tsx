import type { RideCard, RideViewer } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

export interface RideGoingActionProps {
  ride: Pick<RideCard, 'phase' | 'full' | 'limit'>;
  /** Права и роль — с сервера; `null` — гость (публичная карточка без входа). */
  viewer: RideViewer | null;
  /** Строка ленты — secondary/текст справа; герой — primary; карточка — с баннерами и «Не иду». */
  variant: 'row' | 'hero' | 'card';
  /** Идёт запрос «Я иду» / «Не иду». */
  pending?: boolean;
  /** Текст отказа действия — баннер у кнопки. */
  error?: string;
  /** Карточка участника: «Вы идёте · {дата}, {время}». */
  goingLine?: string;
  onJoin: () => void;
  onLeave?: () => void;
}

/** Текст вместо действия (600 ink, не цвет): «Вы идёте», «Мест нет», … */
function StatusText({ label }: { label: string }) {
  const theme = useTheme();
  return <Text style={[textStyle('titleSm'), { color: theme.text.primary }]}>{label}</Text>;
}

/**
 * Участие в райде по `viewer`, `full` и `phase` сервера (клиент ничего не вычисляет): можно записаться — «Я иду»;
 * участник — «Вы идёте» (карточка — баннер и «Не иду»); организатор — «Вы организатор» (карточка — действия
 * управления рисует экран); мест нет — «Мест нет» (карточка — баннер над выключенной «Я иду»); отменён — «Райд
 * отменён»; прошедший и `'unknown'` — без действия.
 */
export function RideGoingAction({
  ride,
  viewer,
  variant,
  pending = false,
  error,
  goingLine,
  onJoin,
  onLeave,
}: RideGoingActionProps) {
  const card = variant === 'card';
  const errorBanner = error ? <Banner tone="warning" message={error} /> : null;

  if (ride.phase === 'cancelled')
    return card ? null : <StatusText label={t('rides.action.cancelled')} />;
  if (ride.phase !== 'upcoming') return null;

  const role = viewer?.role ?? 'none';
  // гость: записаться можно, пока есть места (запись — после входа)
  const canJoin = viewer ? viewer.canJoin : !ride.full;
  const joinButton = (
    <Button
      label={t('rides.action.join')}
      variant={variant === 'row' ? 'secondary' : 'primary'}
      loading={pending}
      onPress={onJoin}
    />
  );

  if (role === 'organizer') return card ? null : <StatusText label={t('rides.action.organizer')} />;
  if (role === 'participant') {
    if (!card) return <StatusText label={t('rides.action.going')} />;
    return (
      <View style={styles.stack}>
        {goingLine ? <Banner message={goingLine} /> : null}
        {viewer?.canLeave && onLeave ? (
          <Button
            label={t('rides.action.leave')}
            variant="secondary"
            loading={pending}
            onPress={onLeave}
          />
        ) : null}
        {errorBanner}
      </View>
    );
  }
  if (role !== 'none') return null;
  if (canJoin) {
    return error ? (
      <View style={styles.stack}>
        {joinButton}
        {errorBanner}
      </View>
    ) : (
      joinButton
    );
  }
  if (!ride.full) return null;
  if (!card) return <StatusText label={t('rides.action.full')} />;
  const reason =
    ride.limit === null
      ? t('rides.error.fullNoLimit')
      : t('rides.error.full', { limit: ride.limit });
  return (
    // причина выключения — видимый текст над кнопкой (подсказки у `Button` базы нет — follow-up `DisabledReason`)
    <View style={styles.stack}>
      <Banner tone="warning" message={reason} />
      <Button label={t('rides.action.join')} disabled />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s2 },
});
