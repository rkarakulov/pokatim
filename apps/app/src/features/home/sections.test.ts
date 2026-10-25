import { AVAILABLE_HOME_SECTIONS, HOME_SECTION_ORDER, orderHomeSections } from './sections';

const base = [
  { id: 'races', chosen: false },
  { id: 'calendar', chosen: false },
];

describe('orderHomeSections (R4, AC4)', () => {
  it('реестр v1 — «Гонки» и «Календарь стартов»; базовый порядок — порядок вкладок (Q1, Q2)', () => {
    expect(HOME_SECTION_ORDER).toEqual(['races', 'rides', 'routes', 'calendar']);
    expect(AVAILABLE_HOME_SECTIONS).toEqual(['races', 'calendar']);
  });

  it('профиль в ожидании или с ошибкой (undefined) — базовый порядок без тегов', () => {
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, undefined)).toEqual(base);
  });

  it('пустой ответ, «Пока просто смотрю», недоступный раздел — базовый порядок без тегов', () => {
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, [])).toEqual(base);
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, ['exploring'])).toEqual(base);
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, ['routes'])).toEqual(base);
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, ['group_rides', 'exploring'])).toEqual(base);
  });

  it('«Календарь» отмечен — первым с тегом', () => {
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, ['calendar'])).toEqual([
      { id: 'calendar', chosen: true },
      { id: 'races', chosen: false },
    ]);
  });

  it('оба отмечены — оба с тегом в порядке вкладок, независимо от порядка ответа', () => {
    const both = [
      { id: 'races', chosen: true },
      { id: 'calendar', chosen: true },
    ];
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, ['races', 'calendar'])).toEqual(both);
    expect(orderHomeSections(AVAILABLE_HOME_SECTIONS, ['calendar', 'exploring', 'races'])).toEqual(
      both,
    );
  });

  it('карта кодов: group_rides → rides, routes → routes; базовый порядок между поднятыми', () => {
    expect(orderHomeSections(HOME_SECTION_ORDER, ['calendar', 'group_rides', 'exploring'])).toEqual(
      [
        { id: 'rides', chosen: true },
        { id: 'calendar', chosen: true },
        { id: 'races', chosen: false },
        { id: 'routes', chosen: false },
      ],
    );
  });

  it('доступные разделы — в базовом порядке, даже если переданы иначе', () => {
    expect(orderHomeSections(['calendar', 'races'], undefined)).toEqual(base);
  });
});
