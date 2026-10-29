import { layout, space } from '@pokatim/design-tokens';
import { Skeleton, SkeletonGroup, SkeletonText } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

/** Первая загрузка билета: заголовок, статус, QR и код, строки — раскладка `TicketDetails`. */
export function TicketSkeleton() {
  return (
    <View testID="ticket-skeleton" style={styles.skeleton}>
      <SkeletonGroup>
        <SkeletonText variant="displaySm" lines={2} lastLineWidth="60%" />
        <View style={styles.qr}>
          <Skeleton width={layout.ticketQr} height={layout.ticketQr} />
        </View>
        <SkeletonText variant="body" lines={5} lastLineWidth="40%" />
      </SkeletonGroup>
    </View>
  );
}

const styles = StyleSheet.create({
  skeleton: { gap: space.s5 },
  qr: { alignItems: 'center', paddingVertical: space.s3 },
});
