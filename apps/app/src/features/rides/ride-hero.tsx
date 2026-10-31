import type { RideCard } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { StyleSheet, View } from 'react-native';

import { GoingStack } from '@/components/going-stack';
import { SectionHero } from '@/components/section-hero';
import { PushSoftPrompt } from '@/features/notifications/push-soft-prompt';
import { api } from '@/lib/api';

import { goingCaption, rideHeroDate, rideHeroMeta } from './format';
import { RideRsvpAction } from './going-action';

/**
 * Герой «Ближайший райд» (вкладка «Райды» и Главная): типографский `SectionHero` — кикер, дата «Сб 3 октября, 9:00»,
 * название, мета «104 км · темп 25–27 км/ч · Минск, место»; под ним стопка участников и одна кнопка участия.
 * Фото организатора (`ride.photo`, ride-photo P4) — под затемнением в блоке героя, без фото — типографский. Нажатие
 * на героя — карточка райда.
 */
export function RideHero({
  ride,
  now,
  kicker = t('rides.heroKicker'),
  distance = null,
  onPress,
}: {
  ride: RideCard;
  now: Date;
  kicker?: string;
  /** «в 12 км от вас» (05c, «Рядом» и точный старт) */
  distance?: string | null;
  onPress: () => void;
}) {
  return (
    <View style={styles.hero}>
      <SectionHero
        kicker={kicker}
        date={{ value: rideHeroDate(ride.startsAt, now) }}
        title={ride.title}
        meta={distance ? [rideHeroMeta(ride), distance] : [rideHeroMeta(ride)]}
        onPress={onPress}
        photo={ride.photo ? api.ridePhotoUrl(ride.photo.id) : null}
      />
      <GoingStack count={ride.goingCount} caption={goingCaption(ride, ride.viewer)} />
      <View style={styles.action}>
        <RideRsvpAction ride={ride} variant="hero" />
      </View>
      <PushSoftPrompt context="ride" id={ride.id} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.s3 },
  action: { alignItems: 'stretch' },
});
