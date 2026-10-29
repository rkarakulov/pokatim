import type { MyTicketRef } from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SectionHeader } from '@rkarakulov/ui';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import type { useMyTickets } from './queries';
import { TicketRow } from './ticket-row';

/** Сколько ближайших билетов на Главной: «Все билеты» нет (раздела нет, §4 Out of Scope). */
export const HOME_TICKETS_LIMIT = 3;

/** Предстоящие, которые стоит показать: без отменённых райдером, по дате события (порядок сервера). */
export const homeTickets = (upcoming: readonly MyTicketRef[]) =>
  upcoming.filter((ticket) => ticket.status !== 'cancelled').slice(0, HOME_TICKETS_LIMIT);

/**
 * «Ваши билеты» на Главной (§5.7, RC-B6): только при предстоящих билетах. Первая загрузка и ошибка без данных — блока
 * нет (без скелетона и повтора — по прецеденту `LandingSection`, G5: у большинства билетов нет, скелетон дал бы
 * «прыжок»); ошибка обновления при показанных данных — данные остаются. Запрос и предзагрузка копий — у экрана
 * (`useMyTickets`), блок только рисует.
 */
export function HomeTickets({ query }: { query: ReturnType<typeof useMyTickets> }) {
  const router = useRouter();
  const tickets = query.data ? homeTickets(query.data.upcoming) : [];
  if (tickets.length === 0) return null;
  return (
    <View testID="home-tickets" style={styles.section}>
      <SectionHeader kicker={t('tickets.home.kicker')} title={t('tickets.home.title')} />
      <View>
        {tickets.map((ticket) => (
          <TicketRow
            key={ticket.code}
            ticket={ticket}
            onPress={() => router.push(`/tickets/${ticket.code}` as Href)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: size.gutter, paddingTop: space.s2, paddingBottom: space.s4 },
});
