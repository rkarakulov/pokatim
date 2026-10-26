import type { RideCard } from '@pokatim/contracts';

import { RideGoingAction, type RideGoingActionProps } from '@/components/ride-going-action';

import { rideActionErrorText, useRideRsvp } from './queries';

/**
 * `RideGoingAction` ленты, героя и Главной с мутацией «Я иду» / «Не иду» своего райда: кнопка выключена на время
 * запроса, отказ — текстом у действия; ответ сервера обновляет кеш и инвалидирует `['rides']`.
 */
export function RideRsvpAction({
  ride,
  variant,
}: {
  ride: RideCard;
  variant: Exclude<RideGoingActionProps['variant'], 'card'>;
}) {
  const rsvp = useRideRsvp(ride.id);
  return (
    <RideGoingAction
      ride={ride}
      viewer={ride.viewer}
      variant={variant}
      pending={rsvp.isPending}
      {...(rsvp.error ? { error: rideActionErrorText(rsvp.error, ride.limit) } : {})}
      onJoin={() => rsvp.mutate('join')}
      onLeave={() => rsvp.mutate('leave')}
    />
  );
}
