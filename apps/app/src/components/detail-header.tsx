import { size, space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useRouter, type Href } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export interface DetailHeaderProps {
  /** Название объекта в title bar; пока данных нет — пусто. */
  title?: string;
  /** Куда «назад», если истории нет (открыли по ссылке): вошедшему — вкладка, гостю — корень. */
  fallback: Href;
}

/**
 * Шапка детального экрана (публичные карточки): «Назад» и название. История есть — назад по ней, нет (ссылка из
 * мессенджера, deep link с холодного старта) — `replace` на `fallback`. Кандидат в `@rkarakulov/ui` (§5.1).
 */
export function DetailHeader({ title, fallback }: DetailHeaderProps) {
  const theme = useTheme();
  const router = useRouter();
  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace(fallback);
  };

  return (
    <View testID="detail-header" style={styles.bar}>
      <TextAction label={t('detail.back')} onPress={back} />
      {title ? (
        <Text
          accessibilityRole="header"
          style={[textStyle('titleSm'), styles.title, { color: theme.text.primary }]}
        >
          {title}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    minHeight: size.topBarHeight,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.s3,
    paddingHorizontal: size.gutter,
  },
  title: { flex: 1 },
});
