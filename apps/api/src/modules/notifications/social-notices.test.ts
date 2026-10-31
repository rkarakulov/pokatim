import { describe, expect, it } from 'vitest';

import type { PublicRiderCard } from '../profile';
import {
  renderSocialNotice,
  SOCIAL_ACTORS_MAX,
  SOCIAL_NOTICE_KINDS,
  socialActorIds,
  socialCollapseKey,
  socialNoticeDraft,
  socialParamsOf,
} from './social-notices';

const RIDE = '01890a5d-ac96-774b-bcce-b302099a8057';
const RACE = '01890a5d-ac96-774b-bcce-b302099a8058';
const ROUTE = '01890a5d-ac96-774b-bcce-b302099a8059';
const KATYA = '01890a5d-ac96-774b-bcce-b302099a8061';
const PETYA = '01890a5d-ac96-774b-bcce-b302099a8062';
const HIDDEN = '01890a5d-ac96-774b-bcce-b302099a8063';
const PUBLIC_ID = 'K'.repeat(43);
const PETYA_ID = 'P'.repeat(43);

/** id события uuidv7 с моментом `at` (первые 48 бит — мс). */
const eventAt = (at: string) => {
  const hex = new Date(at).getTime().toString(16).padStart(12, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7abc-8def-0123456789ab`;
};

const card = (name: string, publicId: string | null = PUBLIC_ID): PublicRiderCard => ({
  name,
  publicId,
  avatarId: null,
});

describe('таблица видов «Свои»', () => {
  it('шесть видов, у «Как прошёл райд?» действующих лиц нет', () => {
    expect(Object.keys(SOCIAL_NOTICE_KINDS)).toEqual([
      'social_riders_going',
      'social_thanks',
      'social_added',
      'social_respect',
      'social_invite_registered',
      'social_ride_ask',
    ]);
    expect(SOCIAL_NOTICE_KINDS.social_ride_ask.actors).toBe(false);
    expect(SOCIAL_ACTORS_MAX).toBe(100);
  });
});

describe('socialCollapseKey — окно схлопывания (RC-7)', () => {
  const ride = { type: 'ride' as const, id: RIDE };

  it('на райд — без дня', () => {
    const at = new Date('2026-10-31T12:00:00Z');
    expect(socialCollapseKey('social_riders_going', ride, at)).toBe(`social:going:${RIDE}`);
    expect(socialCollapseKey('social_thanks', ride, at)).toBe(`social:thanks:${RIDE}`);
    expect(socialCollapseKey('social_ride_ask', ride, at)).toBe(`social:ask:${RIDE}`);
  });

  it('в сутки — календарный день Минска: 20:59Z — тот же день, 21:00Z — следующий', () => {
    expect(socialCollapseKey('social_added', null, new Date('2026-10-31T20:59:59Z'))).toBe(
      'social:added:2026-10-31',
    );
    expect(socialCollapseKey('social_added', null, new Date('2026-10-31T21:00:00Z'))).toBe(
      'social:added:2026-11-01',
    );
    expect(
      socialCollapseKey('social_invite_registered', null, new Date('2026-10-31T21:00:00Z')),
    ).toBe('social:invite:2026-11-01');
  });

  it('на цель в сутки — тип цели, id и день', () => {
    const at = new Date('2026-10-31T21:30:00Z');
    expect(socialCollapseKey('social_respect', { type: 'race', id: RACE }, at)).toBe(
      `social:respect:race:${RACE}:2026-11-01`,
    );
    expect(socialCollapseKey('social_respect', { type: 'route', id: ROUTE }, at)).toBe(
      `social:respect:route:${ROUTE}:2026-11-01`,
    );
  });

  it('вид с окном по объекту без объекта — ошибка', () => {
    expect(() => socialCollapseKey('social_thanks', null, new Date())).toThrow();
  });
});

describe('socialNoticeDraft — черновик для intake (P7)', () => {
  it('на райд: цель ride, ключ окна, одно действующее лицо, название — в тексте', () => {
    const eventId = eventAt('2026-10-31T10:00:00Z');
    expect(
      socialNoticeDraft({
        kind: 'social_riders_going',
        eventId,
        actor: KATYA,
        recipients: [PETYA],
        object: { type: 'ride', id: RIDE, title: 'Кофе-райд' },
      }),
    ).toEqual({
      text: { kind: 'social_riders_going', object: 'Кофе-райд' },
      target: { type: 'ride', rideId: RIDE },
      collapse: { key: `social:going:${RIDE}` },
      actor: KATYA,
      recipients: [PETYA],
    });
  });

  it('респект маршруту — цель my-route; гонке — race; день — по моменту события', () => {
    const eventId = eventAt('2026-10-31T21:00:00Z');
    const route = socialNoticeDraft({
      kind: 'social_respect',
      eventId,
      actor: KATYA,
      recipients: [PETYA],
      object: { type: 'route', id: ROUTE, title: 'Кольцо' },
    });
    expect(route.target).toEqual({ type: 'my-route', routeId: ROUTE });
    expect(route.collapse).toEqual({ key: `social:respect:route:${ROUTE}:2026-11-01` });
    const race = socialNoticeDraft({
      kind: 'social_respect',
      eventId,
      actor: KATYA,
      recipients: [PETYA],
      object: { type: 'race', id: RACE, title: 'Гонка' },
    });
    expect(race.target).toEqual({ type: 'race', raceId: RACE });
  });

  it('«Вас добавили в свои» — без объекта, цель выводится при чтении (в документе null)', () => {
    const draft = socialNoticeDraft({
      kind: 'social_added',
      eventId: eventAt('2026-10-31T10:00:00Z'),
      actor: KATYA,
      recipients: [PETYA],
      object: null,
    });
    expect(draft.target).toBeNull();
    expect(draft.text).toEqual({ kind: 'social_added' });
    expect(draft.collapse).toEqual({ key: 'social:added:2026-10-31' });
  });

  it('«Как прошёл райд?» — снимок без действующих лиц, замена по seq 1 (RC-10)', () => {
    const draft = socialNoticeDraft({
      kind: 'social_ride_ask',
      eventId: eventAt('2026-10-31T10:00:00Z'),
      actor: null,
      recipients: [PETYA],
      object: { type: 'ride', id: RIDE, title: 'Кофе-райд' },
    });
    expect(draft.collapse).toEqual({ key: `social:ask:${RIDE}`, seq: 1 });
    expect(draft).not.toHaveProperty('actor');
  });

  it('длинное название обрезается до 200 символов (params)', () => {
    const draft = socialNoticeDraft({
      kind: 'social_thanks',
      eventId: eventAt('2026-10-31T10:00:00Z'),
      actor: KATYA,
      recipients: [PETYA],
      object: { type: 'ride', id: RIDE, title: 'а'.repeat(300) },
    });
    expect(socialParamsOf(draft.text)).toEqual({ object: 'а'.repeat(200) });
  });

  it('вид с действующими лицами без лица — ошибка', () => {
    expect(() =>
      socialNoticeDraft({
        kind: 'social_thanks',
        eventId: eventAt('2026-10-31T10:00:00Z'),
        actor: null,
        recipients: [PETYA],
        object: { type: 'ride', id: RIDE, title: 'Кофе-райд' },
      }),
    ).toThrow();
  });
});

describe('renderSocialNotice — имена при чтении', () => {
  const stored = {
    title: 'Свои идут',
    body: 'Райдер · «Кофе-райд»',
    target: { type: 'ride' as const, rideId: RIDE },
  };
  const going = (actors: string[], params: unknown = { object: 'Кофе-райд' }) =>
    ({ ...stored, kind: 'social_riders_going' as const, actors, params }) as Parameters<
      typeof renderSocialNotice
    >[0];

  it('одно публичное лицо — его имя и название райда, цель — сохранённая', () => {
    expect(renderSocialNotice(going([KATYA]), new Map([[KATYA, card('Катя Л.')]]))).toEqual({
      title: 'Свои идут',
      body: 'Катя Л. · «Кофе-райд»',
      target: { type: 'ride', rideId: RIDE },
    });
  });

  it('публичное + непубличное — «и ещё 1»; самое свежее публичное — с конца', () => {
    const cards = new Map([
      [KATYA, card('Катя Л.')],
      [PETYA, card('Петя', PETYA_ID)],
    ]);
    expect(renderSocialNotice(going([KATYA, HIDDEN]), cards).body).toBe(
      'Катя Л. и ещё 1 · «Кофе-райд»',
    );
    expect(renderSocialNotice(going([KATYA, PETYA, HIDDEN]), cards).body).toBe(
      'Петя и ещё 2 · «Кофе-райд»',
    );
  });

  it('ни одного публичного — «Райдер»; три непубличных — «Райдер и ещё 2»', () => {
    expect(renderSocialNotice(going([HIDDEN]), new Map()).body).toBe('Райдер · «Кофе-райд»');
    expect(renderSocialNotice(going([HIDDEN, PETYA, KATYA]), new Map()).body).toBe(
      'Райдер и ещё 2 · «Кофе-райд»',
    );
  });

  it('перевод строки в названии и имени схлопывается', () => {
    expect(
      renderSocialNotice(
        going([KATYA], { object: 'Кофе\n  райд' }),
        new Map([[KATYA, card('Катя\nЛ.')]]),
      ).body,
    ).toBe('Катя Л. · «Кофе райд»');
  });

  it('цель rider — publicId того же лица, чьё имя показано; без publicId или публичного — null', () => {
    const added = (actors: string[]) =>
      ({
        kind: 'social_added' as const,
        title: 'Вас добавили в свои',
        body: 'Райдер',
        target: null,
        actors,
        params: {},
      }) as Parameters<typeof renderSocialNotice>[0];
    const cards = new Map([
      [KATYA, card('Катя Л.')],
      [PETYA, card('Петя', null)],
    ]);
    expect(renderSocialNotice(added([HIDDEN, KATYA]), cards)).toEqual({
      title: 'Вас добавили в свои',
      body: 'Катя Л. и ещё 1',
      target: { type: 'rider', publicId: PUBLIC_ID },
    });
    expect(renderSocialNotice(added([KATYA, PETYA]), cards)).toEqual({
      title: 'Вас добавили в свои',
      body: 'Петя и ещё 1',
      target: null,
    });
    expect(renderSocialNotice(added([HIDDEN]), cards).target).toBeNull();
  });

  it('тексты остальных видов', () => {
    const cards = new Map([[KATYA, card('Катя Л.')]]);
    const doc = (kind: string, object?: string) =>
      ({
        kind,
        title: '-',
        body: '-',
        target: null,
        actors: [KATYA],
        params: object === undefined ? {} : { object },
      }) as Parameters<typeof renderSocialNotice>[0];
    expect(renderSocialNotice(doc('social_thanks', 'Кофе-райд'), cards)).toMatchObject({
      title: 'Спасибо за компанию',
      body: 'Катя Л. · «Кофе-райд»',
    });
    expect(renderSocialNotice(doc('social_respect', 'Кольцо'), cards)).toMatchObject({
      title: 'Респект',
      body: 'Катя Л. · «Кольцо»',
    });
    expect(renderSocialNotice(doc('social_invite_registered'), cards)).toMatchObject({
      title: 'По вашей ссылке зарегистрировались',
      body: 'Катя Л.',
      target: { type: 'rider', publicId: PUBLIC_ID },
    });
  });

  it('битые params, нет actors, «Как прошёл райд?» — сохранённый текст и цель', () => {
    const cards = new Map([[KATYA, card('Катя Л.')]]);
    expect(renderSocialNotice(going([KATYA], { object: 42 }), cards)).toEqual(stored);
    expect(renderSocialNotice(going([KATYA], { object: 'x'.repeat(201) }), cards)).toEqual(stored);
    expect(
      renderSocialNotice(
        { ...stored, kind: 'social_riders_going' } as Parameters<typeof renderSocialNotice>[0],
        cards,
      ),
    ).toEqual(stored);
    const ask = {
      kind: 'social_ride_ask' as const,
      title: 'Как прошёл райд?',
      body: '«Кофе-райд»: отметьте, что были.',
      target: { type: 'ride' as const, rideId: RIDE },
    };
    expect(renderSocialNotice(ask, cards)).toEqual({
      title: ask.title,
      body: ask.body,
      target: ask.target,
    });
  });
});

describe('socialActorIds — один запрос имён на страницу', () => {
  it('объединение actors документов группы social, без повторов', () => {
    expect(
      socialActorIds([
        { group: 'social', actors: [KATYA, PETYA] },
        { group: 'social', actors: [PETYA, HIDDEN] },
        { group: 'social' },
        { group: 'rides' },
      ]),
    ).toEqual([KATYA, PETYA, HIDDEN]);
    expect(socialActorIds([{ group: 'rides' }])).toEqual([]);
  });
});
