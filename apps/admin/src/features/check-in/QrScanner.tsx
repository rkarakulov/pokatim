import { t } from '@pokatim/i18n';
import { useEffect, useRef, useState } from 'react';

import { Banner, Button } from '../../ui';
import { createDecoder, type Decoder, SCAN_INTERVAL_MS, scaledSize } from './scanner';

type CameraState = 'idle' | 'starting' | 'scanning' | 'denied' | 'unavailable' | 'error';

const MESSAGE: Partial<Record<CameraState, Parameters<typeof t>[0]>> = {
  starting: 'admin.checkIn.camera.starting',
  scanning: 'admin.checkIn.camera.scanning',
  denied: 'admin.checkIn.camera.denied',
  unavailable: 'admin.checkIn.camera.unavailable',
  error: 'admin.checkIn.camera.error',
};

const cameraAvailable = () =>
  typeof window !== 'undefined' &&
  window.isSecureContext &&
  typeof navigator.mediaDevices?.getUserMedia === 'function';

/**
 * Сканер QR в панели (check-in): камера — только по кнопке (жест пользователя), задняя (`environment`), без звука.
 * Кадры ~5/с (`requestVideoFrameCallback`, иначе таймер), уменьшенные до ≤ 640 px; распознавание — `createDecoder`.
 * `paused` — во время запроса и показа карточки кадры не разбираются. Треки камеры останавливаются при выключении,
 * уходе со страницы и скрытии вкладки. Без камеры экран работает ручным вводом кода.
 */
export function QrScanner({ paused, onScan }: { paused: boolean; onScan: (raw: string) => void }) {
  const [state, setState] = useState<CameraState>('idle');
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const pausedRef = useRef(paused);
  const onScanRef = useRef(onScan);
  useEffect(() => {
    pausedRef.current = paused;
    onScanRef.current = onScan;
  });

  const stop = () => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };

  // уход со страницы и скрытая вкладка — камера выключается
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden' && stream.current) {
        stop();
        setState('idle');
      }
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('visibilitychange', onHidden);
      stop();
    };
  }, []);

  // цикл распознавания, пока камера включена
  useEffect(() => {
    if (state !== 'scanning') return;
    const element = video.current;
    if (!element) return;
    let cancelled = false;
    let decoder: Decoder | null = null;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const schedule = () => {
      if (cancelled) return;
      if (typeof element.requestVideoFrameCallback === 'function') {
        setTimeout(() => {
          if (!cancelled) element.requestVideoFrameCallback(() => void tick());
        }, SCAN_INTERVAL_MS);
      } else {
        setTimeout(() => void tick(), SCAN_INTERVAL_MS);
      }
    };
    const tick = async () => {
      if (cancelled) return;
      try {
        if (!pausedRef.current && context && element.videoWidth > 0) {
          decoder ??= await createDecoder();
          const size = scaledSize(element.videoWidth, element.videoHeight);
          canvas.width = size.width;
          canvas.height = size.height;
          context.drawImage(element, 0, 0, size.width, size.height);
          const raw = await decoder(context.getImageData(0, 0, size.width, size.height));
          if (raw && !cancelled) onScanRef.current(raw);
        }
      } catch {
        // кадр не разобран — следующий
      }
      schedule();
    };
    schedule();
    return () => {
      cancelled = true;
    };
  }, [state]);

  const start = async () => {
    if (!cameraAvailable()) {
      setState('unavailable');
      return;
    }
    setState('starting');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
        audio: false,
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play().catch(() => undefined);
      }
      setState('scanning');
    } catch (error) {
      stop();
      const name = error instanceof DOMException ? error.name : '';
      setState(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'unavailable'
            : 'error',
      );
    }
  };

  const active = state === 'starting' || state === 'scanning';
  const message = MESSAGE[state];
  return (
    <div className="scanner">
      <video
        ref={video}
        className="scanner__video"
        muted
        playsInline
        aria-label={t('admin.checkIn.camera.label')}
        hidden={!active}
      />
      {message ? (
        state === 'starting' || state === 'scanning' ? (
          <p className="t-meta" role="status">
            {t(message)}
          </p>
        ) : (
          <Banner tone="warning">{t(message)}</Banner>
        )
      ) : null}
      <div className="form-actions">
        {active ? (
          <Button
            onClick={() => {
              stop();
              setState('idle');
            }}
          >
            {t('admin.checkIn.camera.stop')}
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void start()}>
            {t('admin.checkIn.camera.start')}
          </Button>
        )}
      </div>
    </div>
  );
}
