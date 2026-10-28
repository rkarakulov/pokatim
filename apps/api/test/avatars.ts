import { crc32 } from 'node:zlib';

import sharp from 'sharp';

/**
 * Тестовые изображения аватаров (rider-profile): генерирует сам sharp, фикстур в git нет. 400×200 — слева красная
 * половина, справа синяя: поворот и обрезку проверяет цвет пикселя результата.
 */
export async function twoToneImage(
  format: 'jpeg' | 'png' | 'webp',
  { orientation }: { orientation?: number } = {},
): Promise<Buffer> {
  const red = await sharp({
    create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  let image = sharp({
    create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } },
  }).composite([{ input: red, left: 0, top: 0 }]);
  if (format === 'jpeg') {
    image = image.jpeg({ quality: 90 });
    if (orientation !== undefined) {
      // EXIF: производитель и GPS-координаты (Минск), затем ориентация
      image = image
        .withExif({
          IFD0: { Make: 'PokatimTest', Model: 'Camera' },
          IFD3: {
            GPSLatitudeRef: 'N',
            GPSLatitude: '53/1 54/1 0/1',
            GPSLongitudeRef: 'E',
            GPSLongitude: '27/1 33/1 0/1',
          },
        })
        .withMetadata({ orientation });
    }
  } else if (format === 'png') {
    image = image.png();
  } else {
    image = image.webp({ lossless: true });
  }
  return image.toBuffer();
}

/** Цвет пикселя результата: `red` | `blue` | `other` (JPEG — с допуском). */
export async function avatarPixel(bytes: Uint8Array, x: number, y: number): Promise<string> {
  const { data, info } = await sharp(bytes).raw().toBuffer({ resolveWithObject: true });
  const at = (y * info.width + x) * info.channels;
  const [r = 0, g = 0, b = 0] = [data[at], data[at + 1], data[at + 2]];
  if (r > 200 && g < 60 && b < 60) return 'red';
  if (b > 200 && r < 60 && g < 60) return 'blue';
  return 'other';
}

/** GIF89a — формат вне белого списка. */
export const GIF_BYTES = Buffer.from(
  '474946383961010001008000000000ffffff21f90401000000002c00000000010001000002024401003b',
  'hex',
);

/** PNG c подделанным `IHDR` 8000×5001 (> 40 Мп) — без реального декодирования. */
export function hugePng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8000, 0);
  ihdr.writeUInt32BE(5001, 4);
  ihdr[8] = 8; // глубина
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x03, 0x00, 0x00, 0x00, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Битый JPEG: сигнатура и мусор. */
export const brokenJpeg = (): Buffer =>
  Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 0x5a)]);
