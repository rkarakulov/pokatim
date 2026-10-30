import { promisify } from 'node:util';
import { gzip } from 'node:zlib';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ROUTE_DERIVED_VERSION, type RouteDerived } from '@pokatim/tracks/parse';
import { CLOCK, type Clock } from '@rkarakulov/api-kit/core';
import { MongoTransactions } from '@rkarakulov/api-kit/mongo';

import { runParseThread, type ThreadOutcome } from '../../parse-thread';
import { ROUTE_POLICY } from './routes.policy';
import { type RouteExportFiles, RoutesRepository } from './routes.repository';

const gzipAsync = promisify(gzip);

/**
 * Уровень gzip экспорта (route-exports-gzip, RC-6): задан явно — при тех же входе и уровне байты детерминированы
 * (сравнение пересчитанного экспорта с прежним), смена дефолта zlib их не изменит.
 */
const EXPORT_GZIP_LEVEL = 6;

/**
 * Строки экспорта из потока разбора → сжатые gzip байты UTF-8 для `route_exports` (route-exports-gzip; разбор и
 * сборка файлов — только в worker). Сжатие — в пуле libuv, не в event loop; вызывать **до** транзакции записи.
 */
export async function exportFilesOf(
  derived: Pick<RouteDerived, 'gpx' | 'kml' | 'tcx'>,
): Promise<RouteExportFiles> {
  const pack = (xml: string) => gzipAsync(xml, { level: EXPORT_GZIP_LEVEL });
  const [gpx, kml, tcx] = await Promise.all([
    pack(derived.gpx),
    pack(derived.kml),
    pack(derived.tcx),
  ]);
  return { gpx, kml, tcx };
}

/** Итог прогона бэкфилла: посчитано, детерминированный отказ, пропуск (сбой окружения); `more` — пачка полная. */
export interface RouteDerivedRun {
  derived: number;
  failed: number;
  skipped: number;
  more: boolean;
}

/**
 * Бэкфилл производных данных готовых маршрутов (routes-03, регламент `routes-maintenance`): маршруты без
 * `derivedVersion` текущей версии — пачкой (`ROUTE_POLICY.deriveBatch`), по одному: исходник из `route_sources` →
 * `deriveRoute` в потоке разбора → транзакция { профиль и версия + экспорт GPX, KML, TCX }. Детерминированный отказ потока —
 * метка `derivedFailure` этой версии (маршрут не берётся снова до роста версии, RC-2); сбой окружения (нет исходника,
 * поток, запись) — лог и пропуск без метки, повтор в следующий прогон. Логи — `routeId` и код, без названия и
 * координат. Идемпотентно: запись — только если версия ещё не посчитана.
 */
@Injectable()
export class RouteDerivedBackfill {
  private readonly logger = new Logger(RouteDerivedBackfill.name);
  /** Версия алгоритма (тест роста версии подменяет). */
  version: number = ROUTE_DERIVED_VERSION;

  constructor(
    private readonly repository: RoutesRepository,
    private readonly transactions: MongoTransactions,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Разбор в потоке с лимитами (точка подмены в тестах). */
  derive(bytes: Uint8Array): Promise<ThreadOutcome<RouteDerived>> {
    return runParseThread<RouteDerived>('deriveRoute', [bytes], ROUTE_POLICY.parseLimits);
  }

  async run(): Promise<RouteDerivedRun> {
    const version = this.version;
    const ids = await this.repository.pendingDerived(version, ROUTE_POLICY.deriveBatch);
    const run: RouteDerivedRun = {
      derived: 0,
      failed: 0,
      skipped: 0,
      more: ids.length === ROUTE_POLICY.deriveBatch,
    };
    for (const id of ids) {
      try {
        const outcome = await this.deriveOne(id, version);
        run[outcome] += 1;
      } catch (error) {
        // класс ошибки без текста: в сообщении драйвера могут быть данные документа
        const kind = error instanceof Error ? error.name : typeof error;
        this.logger.warn(`route ${id} derive skipped: environment error (${kind})`);
        run.skipped += 1;
      }
    }
    return run;
  }

  private async deriveOne(id: string, version: number): Promise<'derived' | 'failed' | 'skipped'> {
    const bytes = await this.repository.sourceBytes(id);
    if (!bytes) {
      this.logger.warn(`route ${id} derive skipped: source is missing`);
      return 'skipped';
    }
    const outcome = await this.derive(bytes);
    if (!outcome.ok) {
      await this.repository.markDerivedFailed(id, version, outcome.code, this.clock.now());
      this.logger.warn(`route ${id} derive failed: ${outcome.code}`);
      return 'failed';
    }
    const { profile } = outcome.result;
    // сжатие до транзакции: не удлиняет её и не повторяется при ретрае TransientTransactionError
    const files = await exportFilesOf(outcome.result);
    const recorded = await this.transactions.run((tx) =>
      this.repository.recordDerived(tx, id, version, profile, files),
    );
    return recorded ? 'derived' : 'skipped';
  }
}
