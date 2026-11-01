import { AVATAR_MAX_BYTES } from '@pokatim/contracts';

import { pickImage } from '@/features/media/pick-image';

import { avatarPickError, type PickedAvatar } from './picked-avatar';

/**
 * Выбор фото профиля (rider-profile) — общий `pickImage(.web)` с пределом 10 МиБ: native — системная обрезка 1:1
 * (`crop` не передаём, сервер берёт центр), web — файл как есть, квадрат выбирает `AvatarCrop`
 * (`avatar-editor.web.tsx`). Отказы выбора — ошибки аватара (`avatarPickError`).
 */
export async function pickAvatar(): Promise<PickedAvatar | null> {
  try {
    return await pickImage({ maxBytes: AVATAR_MAX_BYTES, square: true });
  } catch (error) {
    throw avatarPickError(error);
  }
}
