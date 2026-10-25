import { t } from '@pokatim/i18n';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { httpStatus, isForbidden } from '../../session/errors';
import { EmptyState, ErrorState, PageHeader } from '../../ui';
import { NoAccessScreen } from '../no-access/NoAccessScreen';
import { RaceEditor } from './RaceEditor';
import { raceQuery } from './races-query';

const SKELETON_FIELDS = 8;

/** Скелетон формы под видимой головой страницы (AGENTS.md §4.12). */
function FormSkeleton() {
  return (
    <div className="page-body form-column" aria-busy="true">
      {Array.from({ length: SKELETON_FIELDS }, (_, index) => (
        <div key={index} className="field" data-testid="skeleton-field">
          <span className="skeleton t-label"> </span>
          <span className="skeleton table__skeleton field__control"> </span>
        </div>
      ))}
    </div>
  );
}

/** «Новая гонка». */
export function NewRaceScreen() {
  return <RaceEditor />;
}

/**
 * Гонка панели по id: загрузка — скелетон формы; чужая без `races.manage_any` и несуществующая — 404 «не найдена»
 * (сервер не раскрывает существование); ошибка — с повтором.
 */
export function RaceScreen({ raceId }: { raceId: string }) {
  const race = useQuery(raceQuery(raceId));
  if (race.data) return <RaceEditor key={race.data.id} race={race.data} />;

  const crumb = (
    <Link className="link" to="/races">
      {t('admin.races.title')}
    </Link>
  );
  if (race.isError || race.fetchStatus === 'paused') {
    if (isForbidden(race.error)) return <NoAccessScreen />;
    return (
      <>
        <PageHeader crumb={crumb} title={t('admin.races.title')} />
        <div className="page-body">
          {httpStatus(race.error) === 404 ? (
            <EmptyState title={t('admin.races.notFound')} />
          ) : (
            <ErrorState
              error={race.error}
              offline={race.fetchStatus === 'paused'}
              onRetry={() => void race.refetch()}
            />
          )}
        </div>
      </>
    );
  }
  return (
    <>
      <PageHeader crumb={crumb} title={<span className="skeleton"> </span>} />
      <FormSkeleton />
    </>
  );
}
