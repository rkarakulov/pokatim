/// <reference types="jest" />
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// внутренний путь пакета (публичного входа у функции нет); версия закреплена в devDependencies — как у expo-router
import { createRoutesManifest } from '@expo/router-server/build/routes-manifest';

/**
 * Сторож порядка маршрутов web-сервера (route-rides-02, RC-3): SSR (`expo-server`) берёт первое совпадение
 * `htmlRoutes` манифеста сборки, а он сортирует иначе, чем клиентский роутер (больше динамических сегментов — раньше).
 * Манифест строится той же функцией, что у `expo export`, по файлам `src/app`.
 */
const APP_DIR = join(__dirname, 'app');

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return /\.tsx?$/.test(entry.name) ? [`./${relative(APP_DIR, path)}`] : [];
  });
}

const manifest = createRoutesManifest(routeFiles(APP_DIR), {});
const serverPage = (url: string) =>
  manifest?.htmlRoutes.find((route) => new RegExp(route.namedRegex).test(url))?.page;

const ID = '0190a6f4-0000-7000-8000-000000000001';
const RIDE = '0199e000-0000-7000-8000-0000000000d1';

describe('маршруты web-сервера: первое совпадение SSR', () => {
  it.each([
    [`/routes/pick/${ID}`, '/routes/pick/[routeId]'],
    [`/routes/rides/${ID}/${RIDE}`, '/routes/rides/[routeId]/[rideId]'],
    // route-rides-04 (RC-B5): полный список «Другие» — не карточка `routes/[id]` и не выбор
    [`/routes/others/${ID}`, '/routes/others/[routeId]'],
    [`/routes/${ID}`, '/routes/[id]'],
    [`/routes/mine/${ID}`, '/routes/mine/[id]'],
    [`/routes/report/${ID}`, '/routes/report/[id]'],
    // route-story-card: карточка маршрута для сторис — не карточка маршрута `routes/[id]`
    [`/routes/story/${ID}`, '/routes/story/[id]'],
    [`/races/pick/${ID}`, '/races/pick/[id]'],
    [`/riders/report/${'r'.repeat(43)}`, '/riders/report/[id]'],
    [`/riders/${'r'.repeat(43)}`, '/riders/[id]'],
    ['/achievements/flash', '/achievements/flash'],
    ['/achievements/race_win', '/achievements/[code]'],
    ['/achievements/story/race_win', '/achievements/story/[code]'],
    // guest-landing (RC-1): корневой лендинг, корень — Главная
    ['/welcome', '/welcome'],
    // event-tickets B: билет по ссылке из письма
    ['/tickets/ABCDE12345', '/tickets/[code]'],
    // social P6: короткая ссылка приглашения с карточки для сторис
    ['/i/K7M2PQX', '/i/[code]'],
    ['/', '/(tabs)/index'],
  ])('%s → %s', (url, page) => {
    expect(serverPage(url)).toBe(page);
  });
});
