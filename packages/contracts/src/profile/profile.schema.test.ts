import { describe, expect, it } from 'vitest';

import {
  ProfileView,
  PUBLIC_NAME_CONSENT_VERSION,
  RIDER_CLUB_MAX,
  RIDER_PUBLIC_NAME_MAX,
  RiderClub,
  RiderPublicName,
  UpdateProfileRequest,
  UpdateProfileThemeRequest,
} from './profile.schema.ts';
import { ResetRiderNameRequest, RiderNameResetResult } from './profile-admin.schema.ts';

const codesOf = (result: {
  success: boolean;
  error?: { issues: { message: string; path: PropertyKey[] }[] };
}) => result.error?.issues.map((issue) => issue.message) ?? [];

describe('ProfileView', () => {
  it('известные коды проходят в исходном порядке', () => {
    expect(ProfileView.parse({ rideReasons: ['calendar', 'races'] })).toMatchObject({
      rideReasons: ['calendar', 'races'],
    });
  });

  it('пустой массив — пустой ответ', () => {
    expect(ProfileView.parse({ rideReasons: [] })).toMatchObject({ rideReasons: [] });
  });

  it('неизвестный код новой версии отбрасывается без ошибки разбора (R5)', () => {
    expect(ProfileView.parse({ rideReasons: ['races', 'gravel_camps', 'routes'] })).toMatchObject({
      rideReasons: ['races', 'routes'],
    });
  });

  it('не-массив, не-строки и отсутствие поля — ошибка', () => {
    expect(ProfileView.safeParse({ rideReasons: 'races' }).success).toBe(false);
    expect(ProfileView.safeParse({ rideReasons: [1] }).success).toBe(false);
    expect(ProfileView.safeParse({}).success).toBe(false);
  });

  it('ответ старого сервера без имени, согласия, клуба, аватара и publicId — дефолты', () => {
    expect(ProfileView.parse({ rideReasons: [] })).toEqual({
      rideReasons: [],
      publicName: null,
      showNameInResults: false,
      club: null,
      avatar: null,
      publicId: null,
      themeId: 'classic',
      avatarUploadBlockedUntil: null,
    });
  });

  it('запрет загрузки фото (profile-moderation-followups): дата ISO как есть, нет — null', () => {
    const until = '2026-11-29T10:00:00.000Z';
    expect(
      ProfileView.parse({ rideReasons: [], avatarUploadBlockedUntil: until })
        .avatarUploadBlockedUntil,
    ).toBe(until);
    expect(
      ProfileView.safeParse({ rideReasons: [], avatarUploadBlockedUntil: 'завтра' }).success,
    ).toBe(false);
  });

  it('тема (user-theme): известная — как есть, незнакомая будущая — unknown', () => {
    expect(ProfileView.parse({ rideReasons: [], themeId: 'atlas' })).toMatchObject({
      themeId: 'atlas',
    });
    expect(ProfileView.parse({ rideReasons: [], themeId: 'future-theme' })).toMatchObject({
      themeId: 'unknown',
    });
  });

  it('имя и согласие разбираются как есть', () => {
    expect(
      ProfileView.parse({ rideReasons: [], publicName: 'Анна К.', showNameInResults: true }),
    ).toMatchObject({ rideReasons: [], publicName: 'Анна К.', showNameInResults: true });
  });

  it('клуб, аватар и publicId (rider-profile) разбираются как есть', () => {
    const token = 'a'.repeat(43);
    expect(
      ProfileView.parse({
        rideReasons: [],
        club: 'Velo Club Minsk',
        avatar: { id: token },
        publicId: token.replaceAll('a', 'B'),
      }),
    ).toMatchObject({
      club: 'Velo Club Minsk',
      avatar: { id: token },
      publicId: 'B'.repeat(43),
    });
    expect(ProfileView.safeParse({ rideReasons: [], avatar: { id: 'короткий' } }).success).toBe(
      false,
    );
  });
});

describe('RiderClub (rider-profile)', () => {
  it('обрезка, пусто и null — null; 2–60 символов', () => {
    expect(RiderClub.parse('  Velo Club Minsk ')).toBe('Velo Club Minsk');
    expect(RiderClub.parse('')).toBeNull();
    expect(RiderClub.parse(null)).toBeNull();
    expect(codesOf(RiderClub.safeParse(' V '))).toEqual(['TOO_SHORT']);
    expect(RiderClub.parse('к'.repeat(RIDER_CLUB_MAX))).toHaveLength(60);
    expect(codesOf(RiderClub.safeParse('к'.repeat(RIDER_CLUB_MAX + 1)))).toEqual(['TOO_LONG']);
  });

  it('одна строка без \\p{Cc}/\\p{Cf} и без служебных подписей таблицы', () => {
    expect(codesOf(RiderClub.safeParse('Velo\nClub'))).toEqual(['INVALID']);
    expect(codesOf(RiderClub.safeParse('Velo\u202eClub'))).toEqual(['INVALID']);
    expect(codesOf(RiderClub.safeParse('Участник'))).toEqual(['INVALID']);
    expect(codesOf(RiderClub.safeParse(7))).toEqual(['INVALID']);
  });
});

describe('RiderPublicName', () => {
  it('обрезка, пусто и null — null', () => {
    expect(RiderPublicName.parse('  Анна К. ')).toBe('Анна К.');
    expect(RiderPublicName.parse('')).toBeNull();
    expect(RiderPublicName.parse('   ')).toBeNull();
    expect(RiderPublicName.parse(null)).toBeNull();
  });

  it('2–80 символов после обрезки', () => {
    expect(RiderPublicName.parse(' Ян ')).toBe('Ян');
    expect(codesOf(RiderPublicName.safeParse(' А '))).toEqual(['TOO_SHORT']);
    expect(RiderPublicName.parse('я'.repeat(RIDER_PUBLIC_NAME_MAX))).toHaveLength(80);
    expect(codesOf(RiderPublicName.safeParse('я'.repeat(RIDER_PUBLIC_NAME_MAX + 1)))).toEqual([
      'TOO_LONG',
    ]);
  });

  it('одна строка без управляющих и форматирующих символов (RC-8)', () => {
    expect(codesOf(RiderPublicName.safeParse('Анна\nК.'))).toEqual(['INVALID']);
    expect(codesOf(RiderPublicName.safeParse('Анна\tК.'))).toEqual(['INVALID']);
    expect(codesOf(RiderPublicName.safeParse('Анна‮К.'))).toEqual(['INVALID']);
    expect(codesOf(RiderPublicName.safeParse('Ан​на'))).toEqual(['INVALID']);
    expect(codesOf(RiderPublicName.safeParse(42))).toEqual(['INVALID']);
  });

  it('служебные подписи таблицы — INVALID без учёта регистра (RC-8)', () => {
    for (const reserved of [
      'Вы',
      ' вы ',
      'УЧАСТНИК',
      'Участник',
      'удалённый участник',
      'Удаленный участник',
    ]) {
      expect(codesOf(RiderPublicName.safeParse(reserved))).toEqual(['INVALID']);
    }
    expect(RiderPublicName.parse('Участник 7')).toBe('Участник 7');
  });
});

describe('UpdateProfileRequest', () => {
  it('частичное обновление: одно или оба поля', () => {
    expect(UpdateProfileRequest.parse({ publicName: ' Анна К. ' })).toEqual({
      publicName: 'Анна К.',
    });
    expect(UpdateProfileRequest.parse({ showNameInResults: true })).toEqual({
      showNameInResults: true,
    });
    expect(UpdateProfileRequest.parse({ publicName: '', showNameInResults: false })).toEqual({
      publicName: null,
      showNameInResults: false,
    });
    expect(UpdateProfileRequest.parse({ publicName: null })).toEqual({ publicName: null });
  });

  it('клуб (rider-profile): только он — допустимо; null и "" очищают', () => {
    expect(UpdateProfileRequest.parse({ club: ' Velo Club Minsk ' })).toEqual({
      club: 'Velo Club Minsk',
    });
    expect(UpdateProfileRequest.parse({ club: null })).toEqual({ club: null });
    expect(UpdateProfileRequest.parse({ club: '' })).toEqual({ club: null });
    expect(codesOf(UpdateProfileRequest.safeParse({ club: 'В' }))).toEqual(['TOO_SHORT']);
  });

  it('пустое тело — REQUIRED на корне (RC-7)', () => {
    const result = UpdateProfileRequest.safeParse({});
    expect(result.success).toBe(false);
    expect(result.error?.issues.map(({ path, message }) => ({ path, message }))).toEqual([
      { path: [], message: 'REQUIRED' },
    ]);
  });

  it('лишний ключ, не-boolean и оператор вместо строки — ошибка', () => {
    expect(UpdateProfileRequest.safeParse({ publicName: 'Анна', userId: 'x' }).success).toBe(false);
    expect(codesOf(UpdateProfileRequest.safeParse({ showNameInResults: 'yes' }))).toEqual([
      'INVALID',
    ]);
    expect(codesOf(UpdateProfileRequest.safeParse({ publicName: { $ne: null } }))).toEqual([
      'INVALID',
    ]);
  });
});

describe('PUBLIC_NAME_CONSENT_VERSION (profile-02)', () => {
  it('версия текста согласия — дата ГГГГ-ММ-ДД', () => {
    expect(PUBLIC_NAME_CONSENT_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('ResetRiderNameRequest / RiderNameResetResult (profile-02)', () => {
  it('причина обрезается; ответ — флаг reset', () => {
    expect(ResetRiderNameRequest.parse({ reason: '  Оскорбительное имя ' })).toEqual({
      reason: 'Оскорбительное имя',
    });
    expect(RiderNameResetResult.parse({ reset: false })).toEqual({ reset: false });
    expect(RiderNameResetResult.safeParse({}).success).toBe(false);
  });

  it('без причины — REQUIRED, короткая — TOO_SHORT, лишний ключ — ошибка', () => {
    expect(codesOf(ResetRiderNameRequest.safeParse({}))).toEqual(['REQUIRED']);
    expect(codesOf(ResetRiderNameRequest.safeParse({ reason: 'ab' }))).toEqual(['TOO_SHORT']);
    expect(
      ResetRiderNameRequest.safeParse({ reason: 'Оскорбительное', publicName: null }).success,
    ).toBe(false);
  });
});

describe('UpdateProfileThemeRequest (user-theme)', () => {
  it('тема из списка — валидна', () => {
    expect(UpdateProfileThemeRequest.parse({ themeId: 'atlas' })).toEqual({ themeId: 'atlas' });
  });

  it('незнакомый id, лишний ключ, пусто, не строка — ошибка', () => {
    const unknown = UpdateProfileThemeRequest.safeParse({ themeId: 'neon' });
    expect(unknown.error?.issues).toEqual([
      expect.objectContaining({ path: ['themeId'], message: 'INVALID' }),
    ]);
    expect(UpdateProfileThemeRequest.safeParse({ themeId: 'atlas', decor: 'none' }).success).toBe(
      false,
    );
    expect(UpdateProfileThemeRequest.safeParse({}).success).toBe(false);
    expect(UpdateProfileThemeRequest.safeParse({ themeId: { $ne: null } }).success).toBe(false);
    expect(UpdateProfileThemeRequest.safeParse({ themeId: 1 }).success).toBe(false);
  });
});
