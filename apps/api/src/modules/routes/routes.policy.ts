import {
  MY_ROUTE_MAX_COUNT,
  ROUTE_FILE_MAX_BYTES,
  ROUTE_PUBLICATION_MAX_PENDING,
  ROUTE_EXPORT_FORMATS,
  ROUTE_PUBLICATION_MAX_SUBMISSIONS,
  type RouteDistanceBucket,
  type RouteExportFormat,
} from '@pokatim/contracts';

import { DEFAULT_PARSE_LIMITS } from '../../parse-thread';
import { DEFAULT_BODY_TIMEOUTS } from '../../raw-body';
import type { RouteDoc, RoutePublicationDoc } from './routes.collection';

/** Лимиты модуля `routes` (`[ASSUMPTION]` race-results-01 §7, §8.3). */
export const ROUTE_POLICY = {
  maxFileBytes: ROUTE_FILE_MAX_BYTES,
  /** Загрузок на сотрудника в час. */
  uploadUserLimit: { limit: 20, windowSec: 60 * 60 },
  /** Мои маршруты (routes-02, RC-5): загрузок на райдера и на IP в час — до чтения тела. */
  riderUploadUserLimit: { limit: 20, windowSec: 60 * 60 },
  riderUploadIpLimit: { limit: 60, windowSec: 60 * 60 },
  /** Одновременных приёмов райдеров в процессе API (тело до 5 МиБ в памяти): остальным — 429. */
  riderMaxConcurrentUploads: 4,
  /** Одновременных приёмов одного райдера (upload-limits-kml-panel): второй — 429 до чтения тела. */
  riderMaxConcurrentUploadsPerUser: 1,
  /** Тело загрузки (панель и «мои»): тишина и всё тело — `408` (общие таймауты `src/raw-body.ts`). */
  bodyTimeouts: DEFAULT_BODY_TIMEOUTS,
  /** Квота своих маршрутов райдера (все статусы): больше — `409 ROUTE_QUOTA_EXCEEDED`. */
  riderMaxRoutes: MY_ROUTE_MAX_COUNT,
  /**
   * Обработка дольше — считается зависшей (все попытки BullMQ с бэкоффом укладываются в минуты; запись отказа
   * последней попытки могла не пройти): повторная загрузка того же файла возвращает маршрут в обработку.
   */
  stuckAfterMs: 15 * 60 * 1000,
  /** Разбор: память потока и время — общие лимиты `src/parse-thread.ts`. */
  parseLimits: DEFAULT_PARSE_LIMITS,
  /**
   * Скачиваний файла маршрута каталога с IP в минуту (`[ASSUMPTION]` A2 routes-03) — один бюджет на все форматы
   * (ключ `route-gpx` прежний, routes-formats RC-10: счётчики не сбрасываются).
   */
  exportIpLimit: { limit: 30, windowSec: 60 },
  /**
   * Предел распаковки файла экспорта при отдаче клиенту без gzip (route-exports-gzip): `gunzip` с `maxOutputLength`;
   * TCX на 20 000 точек — ≤ ~4,6 МБ.
   */
  exportMaxBytes: 8 * 1024 * 1024,
  /** Маршрутов за прогон бэкфилла производных (`routes-maintenance`); полная пачка ставит продолжение. */
  deriveBatch: 20,
  /** routes-06 (U8, 8.1 RC-8): успешных подач в каталог на райдера в сутки — списывается прямо перед записью. */
  publicationSubmitLimit: { limit: 10, windowSec: 24 * 60 * 60 },
  /** Жалоб на маршруты на райдера в сутки (U8, как `rides-report`). */
  reportLimit: { limit: 20, windowSec: 24 * 60 * 60 },
  /** Заявок на рассмотрении одновременно и подач одного маршрута (U8). */
  maxPendingPublications: ROUTE_PUBLICATION_MAX_PENDING,
  maxSubmissionsPerRoute: ROUTE_PUBLICATION_MAX_SUBMISSIONS,
} as const;

/** Состояние публикации маршрута райдера; `null` — не подавался. */
export type PublicationState = RoutePublicationDoc['status'] | null;

/** Действия автора (`submit`, `withdraw`) и модератора над публикацией (routes-06, A1, A5). */
export type PublicationAction =
  'submit' | 'withdraw' | 'approve' | 'reject' | 'hide' | 'restore' | 'dismiss';

/** Причина отказа перехода для `details` (`RouteStateDetails`); `null` — без подробностей. */
export type PublicationRefusal = 'in_review' | 'published' | 'hidden' | null;

export type PublicationTransition =
  | { result: 'ok'; to: RoutePublicationDoc['status'] }
  | { result: 'noop' }
  | { result: 'invalid'; reason: PublicationRefusal };

/** Откуда разрешено действие и куда ведёт (A1, A5); `dismiss` статус не меняет. */
const TRANSITIONS: Record<
  PublicationAction,
  { from: readonly PublicationState[]; to: RoutePublicationDoc['status'] }
> = {
  submit: { from: [null, 'withdrawn', 'rejected'], to: 'pending' },
  withdraw: { from: ['pending', 'approved'], to: 'withdrawn' },
  approve: { from: ['pending'], to: 'approved' },
  reject: { from: ['pending'], to: 'rejected' },
  hide: { from: ['approved'], to: 'hidden' },
  restore: { from: ['hidden'], to: 'approved' },
  dismiss: { from: ['approved'], to: 'approved' },
};

const REFUSAL: Partial<Record<RoutePublicationDoc['status'], PublicationRefusal>> = {
  pending: 'in_review',
  approved: 'published',
  hidden: 'hidden',
};

/**
 * Переход публикации — чистая функция (запись повторяет условие в фильтре `RoutesRepository`). Отзыв без активной
 * заявки (нет, `withdrawn`, `rejected`) — `noop` (успех без записи); `hidden` для автора терминален (только удалить).
 */
export function publicationTransition(
  from: PublicationState,
  action: PublicationAction,
): PublicationTransition {
  const rule = TRANSITIONS[action];
  if (rule.from.includes(from)) return { result: 'ok', to: rule.to };
  if (action === 'withdraw' && from !== 'hidden') return { result: 'noop' };
  return { result: 'invalid', reason: from === null ? null : (REFUSAL[from] ?? null) };
}

/**
 * Можно ли подать маршрут (`MyRoute.canPublish`): готовый, заявки нет / отозвана / отклонена и подач меньше 3. Лимит
 * «≤ 3 на рассмотрении» и суточный — проверяет подача (зависят от других документов).
 */
export function canPublish(
  route: Pick<RouteDoc, 'status'> & {
    publication?: Pick<RoutePublicationDoc, 'status' | 'submissionCount'> | null;
  },
): boolean {
  if (route.status !== 'ready') return false;
  const publication = route.publication ?? null;
  return (
    publicationTransition(publication?.status ?? null, 'submit').result === 'ok' &&
    (publication?.submissionCount ?? 0) < ROUTE_POLICY.maxSubmissionsPerRoute
  );
}

/** Предел имени файла маршрута, кодовых точек (без расширения). */
const ROUTE_FILE_NAME_MAX = 80;
/** Имя файла по умолчанию (пустое название) и ASCII-fallback `filename=`. */
const ROUTE_FILE_NAME_FALLBACK = 'pokatim-route';

/**
 * Безопасное имя файла маршрута из названия (routes-03 §7, RC-14; любой формат экспорта), без расширения: удаляются управляющие и
 * форматирующие символы (`\p{Cc}`, `\p{Cf}` — в т. ч. bidi `U+202E`, подмена расширения) и `\/:*?"<>|`, пробелы
 * схлопываются, точки и пробелы по краям обрезаются, ≤ 80 кодовых точек (суррогатная пара не режется); пусто —
 * `pokatim-route`.
 */
export function routeFileName(title: string): string {
  const cleaned = title
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/gu, ' ')
    .replace(/^[\s.]+|[\s.]+$/gu, '');
  const name = Array.from(cleaned)
    .slice(0, ROUTE_FILE_NAME_MAX)
    .join('')
    .replace(/[\s.]+$/u, '');
  return name === '' ? ROUTE_FILE_NAME_FALLBACK : name;
}

/** RFC 5987: `encodeURIComponent` + `'()*` → `%XX`. */
const rfc5987 = (value: string) =>
  encodeURIComponent(value).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** `Content-Disposition` файла маршрута с расширением `extension`: ASCII-fallback и имя из названия (RFC 5987). */
export function routeContentDisposition(title: string, extension: RouteExportFormat): string {
  return `attachment; filename="${ROUTE_FILE_NAME_FALLBACK}.${extension}"; filename*=UTF-8''${rfc5987(`${routeFileName(title)}.${extension}`)}`;
}

/** `Content-Type` файлов экспорта маршрута (routes-03, routes-formats). */
export const ROUTE_EXPORT_CONTENT_TYPES: Record<RouteExportFormat, string> = {
  gpx: 'application/gpx+xml; charset=utf-8',
  kml: 'application/vnd.google-earth.kml+xml; charset=utf-8',
  tcx: 'application/vnd.garmin.tcx+xml; charset=utf-8',
};

/** Версия производных, с которой формат есть в `route_exports` (GPX — routes-03, KML и TCX — routes-formats). */
const EXPORT_FORMAT_SINCE: Record<RouteExportFormat, number> = { gpx: 1, kml: 2, tcx: 2 };

/**
 * Форматы экспорта маршрута по версии производных геометрии (routes-formats RC-2): геометрия и экспорт одной версии
 * пишутся одной транзакцией (`markReady`/`recordDerived`), поэтому `route_exports` не читается. `null` — не
 * посчитаны (экспорта нет).
 */
export function routeExportFormats(derivedVersion: number | null): RouteExportFormat[] {
  if (derivedVersion === null) return [];
  return ROUTE_EXPORT_FORMATS.filter((format) => derivedVersion >= EXPORT_FORMAT_SINCE[format]);
}

/**
 * Корзины дистанции каталога (routes-01 §7), метры: `lt50` < 50 000, `50to100` — [50 000; 100 000], `gt100` > 100 000.
 * Значение — условие MongoDB на `distanceM` (только репозиторий).
 */
export const ROUTE_DISTANCE_RANGES_M: Record<
  RouteDistanceBucket,
  { $gt?: number; $gte?: number; $lt?: number; $lte?: number }
> = {
  lt50: { $lt: 50_000 },
  '50to100': { $gte: 50_000, $lte: 100_000 },
  gt100: { $gt: 100_000 },
};

/** q-значение токена `Accept-Encoding`: по умолчанию 1; невалидное (`abc`, вне `[0, 1]`) — 0 (не принимает). */
function qualityOf(params: string[]): number {
  const q = params.find((param) => param.trim().toLowerCase().startsWith('q='));
  if (q === undefined) return 1;
  const value = q.trim().slice(2);
  if (!/^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(value)) return 0;
  return Number(value);
}

/**
 * Принимает ли клиент ответ `Content-Encoding: gzip` (route-exports-gzip): токены `Accept-Encoding` через запятую,
 * без учёта регистра; явный `gzip`/`x-gzip` решает по своему q (`gzip;q=0` — нет даже при `*`), иначе — `*` с q > 0.
 * Нет заголовка — `false`: безопаснее отдать несжатое.
 */
export function acceptsGzip(header: string | undefined): boolean {
  if (!header) return false;
  let explicit: number | undefined;
  let wildcard: number | undefined;
  for (const token of header.split(',')) {
    const [name = '', ...params] = token.split(';');
    const coding = name.trim().toLowerCase();
    if (coding === 'gzip' || coding === 'x-gzip') {
      explicit = Math.max(explicit ?? 0, qualityOf(params));
    } else if (coding === '*') {
      wildcard = qualityOf(params);
    }
  }
  return (explicit ?? wildcard ?? 0) > 0;
}

/**
 * Значение `Vary` с токеном `token` поверх уже выставленного (`Vary: Origin` от CORS): `setHeader` заменяет заголовок,
 * а ответ с `Cache-Control: public` зависит и от `Origin`, и от `Accept-Encoding`. `*` и уже присутствующий токен
 * (без учёта регистра) — без изменений.
 */
export function varyWith(current: string | string[] | number | undefined, token: string): string {
  const tokens = [current ?? []]
    .flat()
    .flatMap((value) => String(value).split(','))
    .map((value) => value.trim())
    .filter((value) => value !== '');
  if (tokens.includes('*') || tokens.some((value) => value.toLowerCase() === token.toLowerCase())) {
    return tokens.join(', ');
  }
  return [...tokens, token].join(', ');
}
