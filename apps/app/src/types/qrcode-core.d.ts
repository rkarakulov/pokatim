// Ядро `qrcode` без рендереров (canvas, png, fs): одинаково в Metro native, web и SSR-бандле (event-tickets, plan-B §9).
// Типы — из `@types/qrcode` (та же функция `create`).
declare module 'qrcode/lib/core/qrcode' {
  export { create } from 'qrcode';
}
