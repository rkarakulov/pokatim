import { Uuid, type StoryCardTemplate } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  Chip,
  EmptyState,
  Skeleton,
  SkeletonGroup,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { api } from '@/lib/api';
import { shareStory, storyShareMode, type StoryFile } from '@/lib/share-story';

import { DisputeScreenShell, useBackToRace } from '../disputes/dispute-screen';
import { useRace } from '../queries';
import { useStoryCard, useStoryFile } from './queries';
import { storyTemplates } from './story-format';

/** Превью 9:16 — пропорция экспорта 1080×1920 (раскладка, не размер). */
const STORY_ASPECT = 9 / 16;

/** Скелетон превью той же пропорции, пока карточка рендерится (высота — от измеренной ширины колонки). */
function PreviewSkeleton() {
  const [width, setWidth] = useState(0);
  return (
    <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.full}>
      <SkeletonGroup>
        <Skeleton height={width / STORY_ASPECT} width="100%" />
      </SkeletonGroup>
    </View>
  );
}

/** «Поделиться» (системный лист / Web Share с файлом) или «Скачать PNG»; ошибка — баннер, закрытие окна — тихо. */
function ShareAction({ file, error }: { file: StoryFile | undefined; error: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mode = file ? storyShareMode(file) : 'share';
  const press = () => {
    if (!file) return;
    setFailed(false);
    setBusy(true);
    // web: `navigator.share` вызывается синхронно в обработчике — файл подготовлен заранее (RC-13)
    shareStory(file, t('story.title'))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <View style={styles.stack}>
      {failed || error ? <Banner tone="warning" message={t('story.shareFailed')} /> : null}
      <Button
        label={t(mode === 'share' ? 'story.share' : 'story.download')}
        loading={busy || (!file && !error)}
        disabled={!file}
        onPress={press}
      />
    </View>
  );
}

/** Готовая карточка: превью PNG по капабилити-ссылке и действие. */
function ReadyCard({
  raceId,
  template,
  token,
  title,
}: {
  raceId: string;
  template: StoryCardTemplate;
  token: string;
  title: string;
}) {
  const file = useStoryFile(raceId, template, token);
  return (
    <View style={styles.stack}>
      <Image
        source={{ uri: api.storyCardImageUrl(token) }}
        style={styles.preview}
        contentFit="contain"
        accessibilityLabel={t('story.preview', { race: title })}
        accessible
        testID="story-preview"
      />
      <ShareAction file={file.data} error={file.isError} />
    </View>
  );
}

/**
 * Карточка для сторис своего результата (`/races/story/<гонка>`, story-cards R9; внутри `Stack.Protected`): шаблоны
 * «Линия» / «Ночь», превью 9:16 (рендер сервера — скелетон, пока `pending`), «Поделиться» или «Скачать PNG».
 * Карточки нет (409) — «Карточки пока нет» и «К гонке». Права — только сервер (`actions.canShareStory` и 409).
 */
export function StoryCardScreen({ raceId }: { raceId: string }) {
  const theme = useTheme();
  const valid = Uuid.safeParse(raceId).success;
  const [template, setTemplate] = useState<StoryCardTemplate>('line');
  const card = useStoryCard(raceId, template, valid);
  const race = useRace(raceId, undefined, valid);
  const back = useBackToRace(raceId);
  const empty = (
    <EmptyState
      title={t('story.empty.title')}
      action={{ label: t('story.empty.action'), onPress: back }}
    />
  );

  return (
    <DisputeScreenShell title={t('story.title')} raceId={raceId} testID="story-card">
      {valid ? (
        <View style={styles.stack}>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel={t('story.templates')}
            style={styles.chips}
          >
            {storyTemplates.map((item) => (
              <Chip
                key={item.template}
                label={item.label}
                selected={item.template === template}
                onPress={() => setTemplate(item.template)}
              />
            ))}
          </View>
          {card.unavailable ? (
            empty
          ) : (
            <AsyncContent query={card.state} skeleton={<PreviewSkeleton />}>
              {(ready) => (
                <ReadyCard
                  raceId={raceId}
                  template={template}
                  token={ready.token}
                  title={race.data?.title ?? t('story.title')}
                />
              )}
            </AsyncContent>
          )}
          <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
            {t('story.hint')}
          </Text>
        </View>
      ) : (
        empty
      )}
    </DisputeScreenShell>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  preview: { width: '100%', aspectRatio: STORY_ASPECT },
  full: { width: '100%' },
});
