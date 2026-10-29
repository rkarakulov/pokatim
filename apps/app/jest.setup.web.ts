/// <reference types="jest" />
// Web-проект jest (react-native-web, jsdom): дизайн-система с брендом проекта — первым, до модулей экранов.
// Нативные модули (NetInfo, пикер даты) на web не загружаются — моков не нужно.
import './src/theme/design-system';

import { TextEncoder } from 'node:util';

// jsdom без TextEncoder (в браузерах и Hermes он есть): ядро `qrcode` кодирует им payload QR билета
globalThis.TextEncoder ??= TextEncoder as typeof globalThis.TextEncoder;

// стили `maplibre-gl` (побочный импорт карты маршрута): jest не разбирает CSS
jest.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}));
