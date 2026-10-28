import { isNetworkError } from '@pokatim/api-client';
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
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { Image } from 'expo-image';
import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { shareStory, storyPreviewSource, storyShareMode, type StoryFile } from '@/lib/share-story';

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

/**
 * Файл карточки не скачался или превью не отрисовалось: «Нет соединения» (сеть) / «Не удалось загрузить» (ответ
 * сервера, файл не читается) и «Повторить» — повтор подготовки PNG; на время повтора действие выключено (AGENTS §4.12).
 */
function FileFailure({
  error,
  retrying,
  retry,
}: {
  error: unknown;
  retrying: boolean;
  retry: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Banner
        tone="warning"
        title={t(isNetworkError(error) ? 'state.errorTitle' : 'state.failedTitle')}
        message={t('story.shareFailed')}
      />
      <View style={styles.start}>
        <TextAction label={t('state.retry')} onPress={retry} disabled={retrying} />
      </View>
    </View>
  );
}

/** «Поделиться» (системный лист / Web Share с файлом) или «Скачать PNG»; ошибка — баннер, закрытие окна — тихо. */
function ShareAction({ story }: { story: StoryFile | undefined }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mode = story ? storyShareMode(story) : 'share';
  const press = () => {
    if (!story) return;
    setFailed(false);
    setBusy(true);
    // web: `navigator.share` вызывается синхронно в обработчике — файл подготовлен заранее (RC-13)
    shareStory(story, t('story.title'))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return (
    <View style={styles.stack}>
      {failed ? <Banner tone="warning" message={t('story.shareFailed')} /> : null}
      <Button
        label={t(mode === 'share' ? 'story.share' : 'story.download')}
        loading={busy}
        disabled={!story}
        onPress={press}
      />
    </View>
  );
}

/** Источник превью подготовленного файла (web — object URL, отзыв при смене файла и размонтировании). */
function usePreviewUri(story: StoryFile | undefined): string | null {
  const source = useMemo(() => (story ? storyPreviewSource(story) : null), [story]);
  useEffect(() => () => source?.release(), [source]);
  return source?.uri ?? null;
}

/**
 * Готовая карточка: превью — уже подготовленный локальный PNG (тот же файл, что уйдёт в «Поделиться»), до готовности —
 * скелетон; ошибка подготовки или отрисовки — одно место с повтором (`FileFailure`).
 */
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
  const story = file.data;
  const uri = usePreviewUri(story);
  const [previewFailed, setPreviewFailed] = useState(false);
  // баннер остаётся до конца повтора (действие выключено), затем — превью нового файла или снова ошибка
  const retry = () => {
    void file.refetch().then((result) => {
      if (!result.isError) setPreviewFailed(false);
    });
  };
  const failure = (file.isError && !story) || previewFailed;
  return (
    <View style={styles.stack}>
      {failure ? (
        <FileFailure error={file.error} retrying={file.isFetching} retry={retry} />
      ) : uri ? (
        <Image
          source={{ uri }}
          style={styles.preview}
          contentFit="contain"
          accessibilityLabel={t('story.preview', { race: title })}
          accessible
          testID="story-preview"
          onError={() => setPreviewFailed(true)}
        />
      ) : (
        <PreviewSkeleton />
      )}
      <ShareAction story={failure ? undefined : story} />
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
  start: { alignItems: 'flex-start' },
});
