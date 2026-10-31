import type { AchievementList, AchievementProgress } from '@pokatim/contracts';
import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { SkeletonGroup, SkeletonText, textStyle, useTheme } from '@rkarakulov/ui';
import { StyleSheet, Text, View } from 'react-native';

import { ProgressBar } from '@/components/progress-bar';
import { loading, type TabQuery } from '@/features/races/results-table';

import { achievementTitle, levelLabel } from './achievement-catalog';

/** Строка прогресса с известными этой сборке кодом и уровнем (RC-8). */
type KnownProgress = AchievementProgress & {
  code: Exclude<AchievementProgress['code'], 'unknown'>;
  level: Exclude<AchievementProgress['level'], 'unknown'>;
};

const isKnown = (step: AchievementProgress): step is KnownProgress =>
  step.code !== 'unknown' && step.level !== 'unknown';

function ProgressRow({ step }: { step: KnownProgress }) {
  const theme = useTheme();
  const title = achievementTitle(step.code);
  const level = levelLabel(step.level);
  return (
    <View testID={`achievement-progress-${step.code}`} style={styles.row}>
      {/* видимые подписи дублируют подпись полосы — для экранного диктора одна строка */}
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.line}
      >
        <Text style={[textStyle('bodyStrong'), styles.title, { color: theme.text.primary }]}>
          {`${title} · ${level}`}
        </Text>
        <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
          {t('achievements.progress.count', { current: step.current, target: step.target })}
        </Text>
      </View>
      <ProgressBar
        value={step.current}
        max={step.target}
        accessibilityLabel={t('achievements.progress.a11y', {
          title,
          level: level.toLocaleLowerCase('ru'),
          current: step.current,
          target: step.target,
        })}
      />
    </View>
  );
}

/**
 * Блок «Следующие цели» своего профиля (L5): по счётному коду — следующий уровень, полоса и «7 из 15» (данные — тот же
 * `useAchievements()`, второго запроса нет). Первая загрузка — заголовок и скелетон строки (§4.12); прогресса нет,
 * ошибка или офлайн без данных — блока нет (ошибку показывает блок «Достижения», двух баннеров нет). Показывается и
 * без единого достижения.
 */
export function AchievementProgressBlock({
  query,
}: {
  query: TabQuery & { data: AchievementList | undefined };
}) {
  const theme = useTheme();
  const pending = query.data === undefined && loading(query);
  const progress = query.data?.progress.filter(isKnown) ?? [];
  if (!pending && progress.length === 0) return null;
  return (
    <View testID="own-achievement-progress" style={styles.block}>
      <Text
        accessibilityRole="header"
        style={[textStyle('titleSm'), { color: theme.text.primary }]}
      >
        {t('achievements.progress.title')}
      </Text>
      {pending ? (
        <SkeletonGroup>
          <View testID="own-achievement-progress-skeleton" style={styles.row}>
            <SkeletonText variant="bodyStrong" lines={1} lastLineWidth="60%" />
            <SkeletonText variant="meta" lines={1} />
          </View>
        </SkeletonGroup>
      ) : (
        progress.map((step) => <ProgressRow key={step.code} step={step} />)
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  row: { gap: space.s2 },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: space.s2 },
  title: { flex: 1 },
});
