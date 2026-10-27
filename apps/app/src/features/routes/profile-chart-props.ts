import type { CatalogRouteElevation } from '@pokatim/contracts';
import type { AppTheme } from '@pokatim/design-tokens';

import type { ScrubStore } from '@/features/maps/scrub-store';

/** Общий API графика профиля (`profile-chart.tsx` — native, `profile-chart.web.tsx` — web). */
export interface ProfileChartProps {
  elevation: CatalogRouteElevation;
  distanceM: number;
  gainM: number | null;
  theme: AppTheme;
  /** текстовая альтернатива графика (P4): «Профиль высоты: от … до … м, набор … м» */
  label: string;
  /**
   * routes-04: стор скраббинга экрана — график становится `adjustable` (native) / `slider` (web) с курсором и жестами;
   * нет — статичное изображение, как в routes-03.
   */
  scrub?: ScrubStore;
}
