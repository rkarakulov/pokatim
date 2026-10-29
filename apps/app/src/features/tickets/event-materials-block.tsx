import { isNetworkError } from '@pokatim/api-client';
import type { TicketEventKind } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, SkeletonGroup, SkeletonText, TextAction } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

import { EventMaterials, EventMaterialsSection } from '@/components/event-materials';
import { apiErrorCode } from '@/features/auth/error-messages';

import { useEventMaterials } from './materials-query';

/** «Нет соединения» (сеть, ожидание сети) / «Не удалось загрузить» (ответ сервера) и «Повторить». */
function LoadFailure({ network, retry }: { network: boolean; retry: () => void }) {
  return (
    <View testID="event-materials-error" style={styles.failure}>
      <Banner
        tone="warning"
        title={t(network ? 'state.errorTitle' : 'state.failedTitle')}
        message={t('tickets.materials.loadFailed')}
      />
      <View style={styles.start}>
        <TextAction label={t('state.retry')} onPress={retry} />
      </View>
    </View>
  );
}

/**
 * Блок «Материалы» карточки гонки и старта календаря (plan-C §7, AGENTS.md §4.12): первая загрузка — скелетон строк под
 * заголовком; пусто и 404 (событие не опубликовано) — блока нет; ошибка без данных — «Нет соединения» / «Не удалось
 * загрузить» с повтором; ошибка обновления при показанных материалах — они остаются, сверху баннер с повтором.
 */
export function EventMaterialsBlock({ kind, eventId }: { kind: TicketEventKind; eventId: string }) {
  const materials = useEventMaterials(kind, eventId, true);
  const retry = () => void materials.refetch();
  if (apiErrorCode(materials.error) === 'NOT_FOUND') return null;
  const network = isNetworkError(materials.error) || materials.fetchStatus === 'paused';

  if (materials.data === undefined) {
    return (
      <EventMaterialsSection>
        {materials.isError || materials.fetchStatus === 'paused' ? (
          <LoadFailure network={network} retry={retry} />
        ) : (
          <View testID="event-materials-skeleton">
            <SkeletonGroup>
              <SkeletonText variant="body" lines={3} lastLineWidth="60%" />
            </SkeletonGroup>
          </View>
        )}
      </EventMaterialsSection>
    );
  }
  return (
    <EventMaterials
      materials={materials.data}
      notice={materials.isError ? <LoadFailure network={network} retry={retry} /> : null}
    />
  );
}

const styles = StyleSheet.create({
  failure: { gap: space.s2 },
  start: { alignItems: 'flex-start' },
});
