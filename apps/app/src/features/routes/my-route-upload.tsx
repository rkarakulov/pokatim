import { space } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Banner, Button, TextAction, TextField } from '@rkarakulov/ui';
import { StyleSheet, View } from 'react-native';

import { UploadProgress } from '@/features/devices/upload-progress';

import type { useMyRouteUpload } from './use-my-route-upload';

/**
 * Блок «Загрузить маршрут» ленты «Мои» (routes-02): кнопка → шаг «Название» (`TextField`, ошибка под полем,
 * «Загрузить» / «Отменить») → прогресс с «Отменить» → кнопка снова. Отказ pre-check или сервера — баннер.
 */
export function MyRouteUpload({ upload }: { upload: ReturnType<typeof useMyRouteUpload> }) {
  const { state, choose, setTitle, submit, cancel } = upload;
  if (state.phase === 'uploading') {
    return <UploadProgress name={state.name} progress={state.progress} onCancel={cancel} />;
  }
  if (state.phase === 'naming') {
    return (
      <View style={styles.block}>
        <TextField
          label={t('routes.mine.title')}
          value={state.title}
          onChangeText={setTitle}
          error={state.error}
          helper={state.file.name}
          autoCapitalize="sentences"
        />
        <Button label={t('routes.mine.submit')} onPress={() => void submit()} />
        <View style={styles.action}>
          <TextAction label={t('routes.mine.cancel')} onPress={cancel} />
        </View>
      </View>
    );
  }
  return (
    <View style={styles.block}>
      <Button label={t('routes.mine.upload')} onPress={() => void choose()} />
      {state.phase === 'failed' ? <Banner tone="error" message={state.message} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.s3 },
  action: { alignItems: 'flex-start' },
});
