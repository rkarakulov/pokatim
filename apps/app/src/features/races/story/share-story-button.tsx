import { t } from '@pokatim/i18n';
import { Button } from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { storyPath } from './paths';

/** «Поделиться в сторис» (story-cards): только при `actions.canShareStory` сервера — решает вызывающий. */
export function ShareStoryButton({ raceId }: { raceId: string }) {
  const router = useRouter();
  return (
    <View style={styles.start}>
      <Button
        label={t('races.result.shareStory')}
        variant="secondary"
        onPress={() => router.push(storyPath(raceId))}
      />
    </View>
  );
}

const styles = StyleSheet.create({ start: { alignItems: 'flex-start' } });
