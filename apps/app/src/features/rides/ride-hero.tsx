import type { RideCard } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { AvatarStack } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

import { SectionHero } from '@/components/section-hero';

import { goingCaption, rideHeroDate, rideHeroMeta, stackPeople } from './format';
import { RideRsvpAction } from './going-action';

/**
 * Герой «Ближайший райд» (вкладка «Райды» и Главная): типографский `SectionHero` — кикер, дата «Сб 3 октября, 9:00»,
 * название, мета «104 км · темп 25–27 км/ч · Минск, место»; под ним стопка участников и одна кнопка участия.
 * Фото организатора нет (`media`, §4). Нажатие на героя — карточка райда.
 */
export function RideHero({
  ride,
  now,
  kicker = t('rides.heroKicker'),
  onPress,
}: {
  ride: RideCard;
  now: Date;
  kicker?: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.hero}>
      <SectionHero
        kicker={kicker}
        date={{ value: rideHeroDate(ride.startsAt, now) }}
        title={ride.title}
        meta={[rideHeroMeta(ride)]}
        onPress={onPress}
      />
      <AvatarStack
        people={stackPeople(ride.goingCount)}
        caption={goingCaption(ride, ride.viewer)}
      />
      <View style={styles.action}>
        <RideRsvpAction ride={ride} variant="hero" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { gap: space.s3 },
  action: { alignItems: 'stretch' },
});
