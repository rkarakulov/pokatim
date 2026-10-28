import { Uuid } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { EmptyState } from '@rkarakulov/ui';
import { useMemo } from 'react';

import { CardPanel } from '@/features/sharing/card-panel';

import { DisputeScreenShell, useBackToRace } from '../disputes/dispute-screen';
import { useRace } from '../queries';
import { raceStorySource } from './queries';

/**
 * Карточка для сторис своего результата (`/races/story/<гонка>`, story-cards R9; внутри `Stack.Protected`): общая
 * панель карточки (`CardPanel`). Карточки нет (409) — «Карточки пока нет» и «К гонке». Права — только сервер
 * (`actions.canShareStory` и 409).
 */
export function StoryCardScreen({ raceId }: { raceId: string }) {
  const valid = Uuid.safeParse(raceId).success;
  const race = useRace(raceId, undefined, valid);
  const back = useBackToRace(raceId);
  const source = useMemo(() => raceStorySource(raceId), [raceId]);
  const empty = (
    <EmptyState
      title={t('story.empty.title')}
      action={{ label: t('story.empty.action'), onPress: back }}
    />
  );

  return (
    <DisputeScreenShell title={t('story.title')} raceId={raceId} testID="story-card">
      {valid ? (
        <CardPanel
          source={source}
          enabled={valid}
          previewLabel={t('story.preview', { race: race.data?.title ?? t('story.title') })}
          shareTitle={t('story.title')}
          hint={t('story.hint')}
          empty={empty}
        />
      ) : (
        empty
      )}
    </DisputeScreenShell>
  );
}
