import { Image } from 'expo-image';
import { StyleSheet } from 'react-native';

export interface HeroPhotoProps {
  uri: string;
  /** Картинка не загрузилась — родитель переходит на типографский герой. */
  onError: () => void;
}

/**
 * Декоративное фото героя (native): `expo-image` `cover` по центру во весь блок, кэш memory-disk, скрыто от
 * скринридера. Web — `hero-photo.web.tsx` (обычный `<img>`: `expo-image` на web добавляет картинку только в эффекте —
 * в SSR её нет).
 */
export function HeroPhoto({ uri, onError }: HeroPhotoProps) {
  return (
    <Image
      testID="section-hero-photo"
      source={{ uri }}
      style={StyleSheet.absoluteFill}
      contentFit="cover"
      contentPosition="center"
      cachePolicy="memory-disk"
      accessible={false}
      accessibilityLabel=""
      accessibilityIgnoresInvertColors
      onError={onError}
    />
  );
}
