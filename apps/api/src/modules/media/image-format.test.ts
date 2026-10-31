import { describe, expect, it } from 'vitest';

import { GIF_BYTES } from '../../../test/avatars';
import { detectImageFormat } from './image-format';

describe('detectImageFormat — по сигнатуре', () => {
  it('JPEG, PNG, WebP', () => {
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('jpeg');
    expect(
      detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])),
    ).toBe('png');
    expect(detectImageFormat(Buffer.from('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ', 'latin1'))).toBe(
      'webp',
    );
  });

  it('GIF, текст, обрезок сигнатуры, RIFF не WebP, пусто — null', () => {
    expect(detectImageFormat(GIF_BYTES)).toBeNull();
    expect(detectImageFormat(Buffer.from('hello world, not an image'))).toBeNull();
    expect(detectImageFormat(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageFormat(Buffer.from('RIFF\u0000\u0000\u0000\u0000WAVE', 'latin1'))).toBeNull();
    expect(detectImageFormat(new Uint8Array())).toBeNull();
  });
});
