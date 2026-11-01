import { deltaText, formatDelta, goingText, resultText } from './social-home-format';

const rider = (name: string) => ({ name, publicId: 'p'.repeat(43), avatar: null });

describe('секция «Свои» на Главной: тексты (K7, social-p7)', () => {
  it('«идёт» — один и «и ещё N» — остальные «свои», включая не показанных', () => {
    expect(goingText({ riders: [rider('Катя Л.')], othersCount: 0 })).toBe('Катя Л. идёт');
    expect(goingText({ riders: [rider('Катя Л.'), rider('Ева')], othersCount: 0 })).toBe(
      'Катя Л. и ещё 1 идут',
    );
    expect(
      goingText({ riders: [rider('Катя Л.'), rider('Ева'), rider('Денис')], othersCount: 4 }),
    ).toBe('Катя Л. и ещё 6 идут');
  });

  it('результат — имя и время h:mm:ss', () => {
    expect(resultText({ rider: rider('Андрей К.'), elapsedSec: 7180 })).toBe('Андрей К. · 1:59:40');
  });

  it('разница — знак сервера: минус — быстрее; ноль — одно время; null — без строки', () => {
    expect(deltaText(-80)).toBe('на 1:20 быстрее вас');
    expect(deltaText(3725)).toBe('на 1:02:05 медленнее вас');
    expect(deltaText(0)).toBe('одно время с вами');
    expect(deltaText(null)).toBeNull();
  });

  it('длительность разницы: до часа — m:ss, дальше — h:mm:ss', () => {
    expect(formatDelta(5)).toBe('0:05');
    expect(formatDelta(599)).toBe('9:59');
    expect(formatDelta(3600)).toBe('1:00:00');
  });
});
