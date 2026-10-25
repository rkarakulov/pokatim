// Лёгкий вход для приложения (Expo iOS/Android/web): без парсеров FIT/GPX и их зависимостей.
// Схема потока агрегатора — здесь (zod); разбор файлов и распаковка потока — `@pokatim/tracks/parse` (worker API).
export * from './geo.ts';
export * from './track.ts';
export * from './format.ts';
export * from './precheck.ts';
export * from './points.ts';
export * from './summary.ts';
export * from './simplify.ts';
export * from './plausibility.ts';
export * from './stream.ts';
