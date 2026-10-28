import { isNetworkError } from '@pokatim/api-client';
import type { StoryCardTemplate } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import {
  AsyncContent,
  Banner,
  Button,
  Chip,
  Skeleton,
  SkeletonGroup,
  TextAction,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { Image } from 'expo-image';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { shareStory, storyPreviewSource, storyShareMode, type StoryFile } from '@/lib/share-story';

import { type CardSource, cardTemplates, useCardFile, useCardStatus } from './card-status';

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
  offline,
  retrying,
  retry,
}: {
  error: unknown;
  /** запрос файла на паузе без сети (`fetchStatus: 'paused'`) — «Нет соединения» без ошибки запроса */
  offline: boolean;
  retrying: boolean;
  retry: () => void;
}) {
  return (
    <View style={styles.stack}>
      <Banner
        tone="warning"
        title={t(offline || isNetworkError(error) ? 'state.errorTitle' : 'state.failedTitle')}
        message={t('story.shareFailed')}
      />
      <View style={styles.start}>
        <TextAction label={t('state.retry')} onPress={retry} disabled={retrying} />
      </View>
    </View>
  );
}

/** «Поделиться» (системный лист / Web Share с файлом) или «Скачать PNG»; ошибка — баннер, закрытие окна — тихо. */
function ShareAction({ story, title }: { story: StoryFile | undefined; title: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mode = story ? storyShareMode(story) : 'share';
  const press = () => {
    if (!story) return;
    setFailed(false);
    setBusy(true);
    // web: `navigator.share` вызывается синхронно в обработчике — файл подготовлен заранее (RC-13)
    shareStory(story, title)
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
  fileKey,
  token,
  previewLabel,
  shareTitle,
}: {
  fileKey: readonly unknown[];
  token: string;
  previewLabel: string;
  shareTitle: string;
}) {
  const file = useCardFile(fileKey, token);
  const story = file.data;
  const uri = usePreviewUri(story);
  const [previewFailed, setPreviewFailed] = useState(false);
  // баннер остаётся до конца повтора (действие выключено), затем — превью нового файла или снова ошибка
  const retry = () => {
    void file.refetch().then((result) => {
      if (!result.isError) setPreviewFailed(false);
    });
  };
  // без сети запрос файла встаёт на паузу без ошибки — без сообщения остался бы вечный скелетон
  const offline = !story && file.fetchStatus === 'paused';
  const failure = (file.isError && !story) || offline || previewFailed;
  return (
    <View style={styles.stack}>
      {failure ? (
        <FileFailure
          error={file.error}
          offline={offline}
          retrying={file.fetchStatus === 'fetching'}
          retry={retry}
        />
      ) : uri ? (
        <Image
          source={{ uri }}
          style={styles.preview}
          contentFit="contain"
          accessibilityLabel={previewLabel}
          accessible
          testID="story-preview"
          onError={() => setPreviewFailed(true)}
        />
      ) : (
        <PreviewSkeleton />
      )}
      <ShareAction story={failure ? undefined : story} title={shareTitle} />
    </View>
  );
}

/**
 * Карточка сервера (ADR-0018) на экране: чипы шаблонов «Линия» / «Ночь», превью 9:16 (рендер сервера — скелетон,
 * пока `pending`), «Поделиться» или «Скачать PNG», подсказка. Карточки нет (409) или источник не найден (404) —
 * `empty` вызывающего. Права — только сервер.
 */
export function CardPanel({
  source,
  enabled,
  previewLabel,
  shareTitle,
  hint,
  empty,
}: {
  source: CardSource;
  enabled: boolean;
  previewLabel: string;
  shareTitle: string;
  hint: string;
  empty: ReactNode;
}) {
  const theme = useTheme();
  const [template, setTemplate] = useState<StoryCardTemplate>('line');
  const card = useCardStatus(source, template, enabled);
  return (
    <View style={styles.stack}>
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel={t('story.templates')}
        style={styles.chips}
      >
        {cardTemplates.map((item) => (
          <Chip
            key={item.template}
            label={item.label}
            selected={item.template === template}
            onPress={() => setTemplate(item.template)}
          />
        ))}
      </View>
      {card.unavailable || card.notFound ? (
        empty
      ) : (
        <AsyncContent query={card.state} skeleton={<PreviewSkeleton />}>
          {(ready) => (
            <ReadyCard
              // состояние превью (ошибка отрисовки) — своё у каждой карточки, не переносится на другой шаблон
              key={`${template}:${ready.token}`}
              fileKey={source.key(template)}
              token={ready.token}
              previewLabel={previewLabel}
              shareTitle={shareTitle}
            />
          )}
        </AsyncContent>
      )}
      <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>{hint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s4 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  preview: { width: '100%', aspectRatio: STORY_ASPECT },
  full: { width: '100%' },
  start: { alignItems: 'flex-start' },
});
