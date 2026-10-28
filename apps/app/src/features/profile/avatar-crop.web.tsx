import type { AvatarCrop as CropQuery } from '@pokatim/api-client';
import { size, space, stroke } from '@pokatim/design-tokens';
import { t } from '@pokatim/i18n';
import { Button, TextAction, textStyle, useTheme } from '@rkarakulov/ui';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/icon';

import {
  initialCrop,
  maxScale,
  pan,
  scaleOf,
  toCropQuery,
  tooSmall,
  zoom,
  type CropState,
  type ImageSize,
} from './avatar-crop-math';

/** Шаг масштаба кнопок и клавиш «+»/«−». */
const ZOOM_STEP = 1.25;
/** Сдвиг стрелкой — доля стороны квадрата; с Shift — крупнее. */
const PAN_STEP = 0.05;
const PAN_STEP_LARGE = 0.2;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

interface Drag {
  pointerId: number;
  x: number;
  y: number;
}

/**
 * Обрезка фото профиля в браузере (rider-profile, AC14): квадратное окно с фото, перетаскивание (pointer events с
 * захватом указателя), масштаб кнопками «−»/«+» и клавишами (колесо не используем — прокрутка страницы). Клавиатура
 * на окне: стрелки — сдвиг (Shift — крупнее), `+`/`=` и `-` — масштаб. Размеры — `naturalWidth/Height` после
 * загрузки (браузер уже применил EXIF-ориентацию, как сервер); на сервер — только доли (`onConfirm`). Фото меньше
 * 64 × 64 — `onTooSmall`, файл не декодируется — `onUnreadable` (оба без отправки). Переходов нет — положение задаётся напрямую (reduce motion не нужен).
 */
export function AvatarCrop({
  file,
  saving,
  onConfirm,
  onCancel,
  onTooSmall,
  onUnreadable,
}: {
  file: File;
  saving: boolean;
  onConfirm: (crop: CropQuery) => void;
  onCancel: () => void;
  onTooSmall: () => void;
  /** браузер не смог декодировать файл (битый, HEIC под видом JPEG) — сервер ответил бы 422 */
  onUnreadable: () => void;
}) {
  const theme = useTheme();
  const hintId = useId();
  const frame = useRef<HTMLDivElement>(null);
  const photo = useRef<HTMLImageElement>(null);
  const drag = useRef<Drag | null>(null);
  const [image, setImage] = useState<ImageSize>();
  const [crop, setCrop] = useState<CropState>();
  const [focused, setFocused] = useState(false);

  // адрес файла — в DOM фото напрямую (не состояние): создаётся после монтирования, освобождается при размонтировании;
  // новый файл — новый экземпляр панели (редактор показывает её только после выбора)
  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    if (photo.current) photo.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  const onLoad = (element: HTMLImageElement) => {
    const loaded = { width: element.naturalWidth, height: element.naturalHeight };
    if (tooSmall(loaded)) {
      onTooSmall();
      return;
    }
    setImage(loaded);
    setCrop(initialCrop(loaded));
  };

  const ready = image !== undefined && crop !== undefined;
  const scale = ready ? scaleOf(crop, image) : 1;
  const canZoomIn = ready && scale < maxScale(image);
  const canZoomOut = ready && scale > 1;
  const zoomBy = (factor: number) => {
    if (ready) setCrop(zoom(crop, factor, image));
  };
  const panBy = (dx: number, dy: number) => {
    if (ready) setCrop(pan(crop, dx, dy, image));
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const width = frame.current?.clientWidth ?? 0;
    if (!current || current.pointerId !== event.pointerId || !ready || width === 0) return;
    // палец тянет фото: квадрат обрезки сдвигается в обратную сторону, пиксели окна → пиксели исходника
    const ratio = crop.side / width;
    panBy(-(event.clientX - current.x) * ratio, -(event.clientY - current.y) * ratio);
    drag.current = { ...current, x: event.clientX, y: event.clientY };
  };
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId === event.pointerId) drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!ready) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      const step = crop.side * (event.shiftKey ? PAN_STEP_LARGE : PAN_STEP);
      panBy(arrow[0] * step, arrow[1] * step);
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      zoomBy(ZOOM_STEP);
    } else if (event.key === '-') {
      event.preventDefault();
      zoomBy(1 / ZOOM_STEP);
    }
  };

  // фото в окне: окно — квадрат обрезки; проценты от стороны окна (окно квадратное — и для top тоже)
  const photoStyle = ready
    ? {
        position: 'absolute' as const,
        width: `${(image.width / crop.side) * 100}%`,
        height: `${(image.height / crop.side) * 100}%`,
        left: `${(-crop.left / crop.side) * 100}%`,
        top: `${(-crop.top / crop.side) * 100}%`,
        maxWidth: 'none',
      }
    : { position: 'absolute' as const, opacity: 0 };

  return (
    <View testID="avatar-crop" style={styles.stack}>
      <Text
        accessibilityRole="header"
        style={[textStyle('label'), { color: theme.text.secondary }]}
      >
        {t('profile.avatar.crop.title')}
      </Text>
      <div
        ref={frame}
        role="group"
        aria-label={t('profile.avatar.crop.area')}
        aria-describedby={hintId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: size.heroHeight,
          aspectRatio: '1',
          overflow: 'hidden',
          touchAction: 'none',
          userSelect: 'none',
          cursor: 'grab',
          backgroundColor: theme.surface.raised,
          borderStyle: 'solid',
          borderWidth: stroke.indicator,
          borderColor: focused ? theme.border.focus : theme.border.strong,
          boxSizing: 'border-box',
        }}
      >
        <img
          ref={photo}
          alt=""
          draggable={false}
          onLoad={(event) => onLoad(event.currentTarget)}
          onError={onUnreadable}
          style={photoStyle}
        />
      </div>
      <Text nativeID={hintId} style={[textStyle('meta'), { color: theme.text.secondary }]}>
        {t('profile.avatar.crop.keys')}
      </Text>
      <View style={styles.zoom}>
        <ZoomButton
          name="zoomOut"
          label={t('profile.avatar.crop.zoomOut')}
          disabled={!canZoomOut}
          onPress={() => zoomBy(1 / ZOOM_STEP)}
        />
        <ZoomButton
          name="zoomIn"
          label={t('profile.avatar.crop.zoomIn')}
          disabled={!canZoomIn}
          onPress={() => zoomBy(ZOOM_STEP)}
        />
      </View>
      <Button
        label={t('profile.avatar.crop.save')}
        disabled={!ready}
        loading={saving}
        onPress={() => {
          if (ready) onConfirm(toCropQuery(crop, image));
        }}
      />
      <View style={styles.start}>
        <TextAction label={t('profile.avatar.crop.cancel')} disabled={saving} onPress={onCancel} />
      </View>
    </View>
  );
}

function ZoomButton({
  name,
  label,
  disabled,
  onPress,
}: {
  name: 'zoomIn' | 'zoomOut';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.zoomButton, { borderColor: theme.border.strong }]}
    >
      <Icon
        name={name}
        size={size.icon}
        color={disabled ? theme.text.disabled : theme.text.primary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.s3 },
  start: { alignItems: 'flex-start' },
  zoom: { flexDirection: 'row', gap: space.s2 },
  zoomButton: {
    minWidth: size.touchMin,
    minHeight: size.touchMin,
    borderWidth: stroke.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
