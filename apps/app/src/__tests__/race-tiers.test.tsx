/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { router as expoRouter } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import VerifiedProfileScreen from '../app/settings/verified';
import { tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { myDisputes } from './disputes-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  actions,
  myEntry,
  noEntry,
  noEntryTiers,
  RACE_ID,
  result,
  resultsPage,
  startEntry,
  verifiedState,
  verifiedView,
  corridorRace,
} from './races-fixtures';

jest.mock('@/lib/api');

const getRace = jest.mocked(api.getRace);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);
const enterRace = jest.mocked(api.enterRace);
const getRaceResults = jest.mocked(api.getRaceResults);

/** «Сейчас»: 8 октября 2026, 21:00 по Минску — окно открыто. */
const NOW = new Date('2026-10-08T18:00:00Z');
const TOKEN = liveSession.accessToken;
const conflict = (code: string) => new ApiHttpError(409, { code, message: 'x' });

const open = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
  return renderRouter(
    { ...tabRoutes, 'races/[id]': RaceRoute, 'settings/verified': VerifiedProfileScreen },
    { initialUrl: `/races/${RACE_ID}`, wrapper: createQueryWrapper() },
  );
};

const participation = () => within(screen.getByTestId('race-participation'));
const verified = () => within(screen.getByTestId('tier-verified'));
const start = () => within(screen.getByTestId('tier-start'));

beforeEach(() => {
  // материалы события (event-tickets PR C): по умолчанию у события их нет — блока нет
  jest.mocked(api.getEventMaterials).mockResolvedValue([]);
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRace.mockResolvedValue(corridorRace());
  getMyRaceEntry.mockResolvedValue(noEntryTiers());
  getRaceResults.mockResolvedValue(resultsPage());
  jest.mocked(api.getMyRaceDisputes).mockResolvedValue(myDisputes());
  jest.mocked(api.listRaces).mockResolvedValue({ items: [], nextCursor: null });
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('заявка: выбор уровня (07c)', () => {
  it('Verified и START с объяснением; своя группа выбрана по умолчанию, младшая — на выбор', async () => {
    await open();

    expect(await screen.findByText('Уровень участия')).toBeOnTheScreen();
    expect(verified().getByRole('header', { name: 'Verified' })).toBeOnTheScreen();
    expect(verified().getByText(/Место в своей группе/)).toBeOnTheScreen();
    expect(start().getByRole('header', { name: 'START' })).toBeOnTheScreen();
    expect(start().getByText(/Время и отметка «Финишёр»/)).toBeOnTheScreen();
    const groups = within(screen.getByTestId('group-picker'));
    expect(groups.getByRole('button', { name: 'Мужчины 40–49', selected: true })).toBeOnTheScreen();
    expect(
      groups.getByRole('button', { name: 'Мужчины до 40', selected: false }),
    ).toBeOnTheScreen();
    // старой кнопки «Участвовать» без уровня нет
    expect(screen.queryByRole('button', { name: 'Участвовать' })).toBeNull();
  });

  it('Verified в младшей группе → enterRace({ tier, groupKey }), кнопка занята, затем — участие', async () => {
    let resolve: (value: ReturnType<typeof myEntry>) => void = () => undefined;
    enterRace.mockReturnValue(new Promise((r) => (resolve = r)));
    await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Мужчины до 40' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Участвовать в Verified' }));
    expect(enterRace).toHaveBeenCalledWith(TOKEN, RACE_ID, { tier: 'verified', groupKey: 'm_u40' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Участвовать в Verified' })).toBeDisabled(),
    );
    // вторая кнопка уровня тоже неактивна: параллельной заявки другого уровня нет (ревью pass 1)
    expect(screen.getByRole('button', { name: 'Участвовать в START' })).toBeDisabled();

    await act(async () =>
      resolve(
        myEntry({
          groupScheme: 'gender_age',
          entry: { ...myEntry().entry!, tier: 'verified', groupKey: 'm_u40' },
          verified: verifiedState(),
          result: result({ group: 'm_u40' }),
        }),
      ),
    );
    expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();
    expect(participation().getByText('Verified · Мужчины до 40')).toBeOnTheScreen();
    expect(screen.queryByText('Уровень участия')).toBeNull();
  });

  it('START — сразу, без анкеты и группы', async () => {
    enterRace.mockResolvedValue(startEntry({ actions: actions({ canWithdraw: true }) }));
    await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать в START' }));
    expect(enterRace).toHaveBeenCalledWith(TOKEN, RACE_ID, { tier: 'start' });
    expect(await participation().findByText('START')).toBeOnTheScreen();
  });

  it('Verified без анкеты — «Заполнить анкету» ведёт на анкету с возвратом к гонке', async () => {
    getMyRaceEntry.mockResolvedValue(
      noEntryTiers({
        verified: verifiedState({ profileReady: false, ownGroup: null, groupOptions: null }),
      }),
    );
    jest.mocked(api.getVerifiedProfile).mockResolvedValue(verifiedView({ profile: null }));
    const router = await open();

    expect(await screen.findByText(/Для Verified заполните анкету/)).toBeOnTheScreen();
    expect(verified().getByRole('button', { name: 'Заполнить анкету' })).toBeOnTheScreen();
    expect(screen.queryByTestId('group-picker')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Участвовать в Verified' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Заполнить анкету' }));

    expect(await screen.findByRole('header', { name: 'Анкета зачёта' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/settings/verified');
    expect(router.getSearchParams()).toEqual({ race: RACE_ID });
    expect(screen.getByRole('button', { name: 'Вернуться к гонке' })).toBeOnTheScreen();
  });

  it('409 VERIFIED_PROFILE_REQUIRED — переход к анкете с возвратом к гонке (§11.3), участие перезапрошено', async () => {
    enterRace.mockRejectedValue(conflict('VERIFIED_PROFILE_REQUIRED'));
    jest.mocked(api.getVerifiedProfile).mockResolvedValue(verifiedView({ profile: null }));
    const router = await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать в Verified' }));
    expect(await screen.findByRole('header', { name: 'Анкета зачёта' })).toBeOnTheScreen();
    expect(router.getPathname()).toBe('/settings/verified');
    expect(router.getSearchParams()).toEqual({ race: RACE_ID });
    await waitFor(() => expect(getMyRaceEntry).toHaveBeenCalledTimes(2));
  });

  it('START, пока идёт заявка, — обе кнопки уровня неактивны', async () => {
    enterRace.mockReturnValue(new Promise(() => undefined));
    await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать в START' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Участвовать в START' })).toBeDisabled(),
    );
    expect(screen.getByRole('button', { name: 'Участвовать в Verified' })).toBeDisabled();
  });

  it('после Verified-заявки кэш анкеты устаревает: пол и год открываются зафиксированными', async () => {
    const getVerifiedProfile = jest.mocked(api.getVerifiedProfile);
    getVerifiedProfile.mockResolvedValue(verifiedView());
    enterRace.mockResolvedValue(
      myEntry({
        groupScheme: 'gender_age',
        entry: { ...myEntry().entry!, tier: 'verified', groupKey: 'm_u40' },
        verified: verifiedState(),
      }),
    );
    await open();
    await screen.findByRole('button', { name: 'Участвовать в Verified' });
    // анкета открыта до заявки — в кэше свежая незафиксированная
    await act(() => expoRouter.push(`/settings/verified?race=${RACE_ID}`));
    expect(await screen.findByRole('button', { name: 'Женский' })).toBeOnTheScreen();
    await act(() => expoRouter.back());

    getVerifiedProfile.mockResolvedValue(verifiedView({ demographicsLocked: true }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать в Verified' }));
    expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();

    await act(() => expoRouter.push(`/settings/verified?race=${RACE_ID}`));
    expect(
      await screen.findByText(
        'Пол и год рождения зафиксированы заявкой Verified — изменить их может команда платформы.',
      ),
    ).toBeOnTheScreen();
    expect(getVerifiedProfile).toHaveBeenCalledTimes(2);
  });

  it('422 RESULT_GROUP_NOT_ALLOWED — текст по коду', async () => {
    enterRace.mockRejectedValue(
      new ApiHttpError(422, { code: 'RESULT_GROUP_NOT_ALLOWED', message: 'x' }),
    );
    await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать в Verified' }));
    expect(
      await screen.findByText('Можно выбрать свою группу или более молодую своего пола'),
    ).toBeOnTheScreen();
  });

  it('схема overall — выбора уровня нет, «Участвовать» без тела (DV-1)', async () => {
    getMyRaceEntry.mockResolvedValue(noEntry({ verified: null }));
    enterRace.mockResolvedValue(myEntry());
    await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Участвовать' }));
    expect(enterRace).toHaveBeenCalledWith(TOKEN, RACE_ID);
    expect(screen.queryByText('Уровень участия')).toBeNull();
  });
});

describe('«Повысить до Verified» (07c)', () => {
  it('canUpgrade — раскрывается с группой, повышение шлёт verified и группу', async () => {
    getMyRaceEntry.mockResolvedValue(startEntry());
    enterRace.mockResolvedValue(
      myEntry({
        groupScheme: 'gender_age',
        entry: { ...myEntry().entry!, tier: 'verified', groupKey: 'm_40_49' },
        verified: verifiedState(),
        result: result({ group: 'm_40_49' }),
      }),
    );
    await open();

    expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();
    expect(participation().getByText('START')).toBeOnTheScreen();
    await fireEvent.press(participation().getByRole('button', { name: 'Повысить до Verified' }));
    const upgrade = within(screen.getByTestId('tier-upgrade'));
    expect(upgrade.getByText(/Вернуться на START нельзя/)).toBeOnTheScreen();
    await fireEvent.press(upgrade.getByRole('button', { name: 'Повысить до Verified' }));

    expect(enterRace).toHaveBeenCalledWith(TOKEN, RACE_ID, {
      tier: 'verified',
      groupKey: 'm_40_49',
    });
    expect(await participation().findByText('Verified · Мужчины 40–49')).toBeOnTheScreen();
    expect(screen.queryByTestId('tier-upgrade')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Повысить до Verified' })).toBeNull();
  });

  it('«Не сейчас» сворачивает; 409 RACE_TIER_LOCKED — текст по коду', async () => {
    getMyRaceEntry.mockResolvedValue(startEntry());
    enterRace.mockRejectedValue(conflict('RACE_TIER_LOCKED'));
    await open();

    await fireEvent.press(await screen.findByRole('button', { name: 'Повысить до Verified' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(screen.queryByTestId('tier-upgrade')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Повысить до Verified' }));
    await fireEvent.press(
      within(screen.getByTestId('tier-upgrade')).getByRole('button', {
        name: 'Повысить до Verified',
      }),
    );
    expect(
      await screen.findByText('Уровень и группу заявки уже нельзя изменить'),
    ).toBeOnTheScreen();
  });

  it('без canUpgrade — действия нет', async () => {
    getMyRaceEntry.mockResolvedValue(startEntry({ actions: actions({ canWithdraw: true }) }));
    await open();

    expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();
    expect(participation().getByText('START')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Повысить до Verified' })).toBeNull();
  });
});

describe('моё участие: группа, место, «Финишёр» (07c)', () => {
  it('Verified с местом — группа и место в группе', async () => {
    getMyRaceEntry.mockResolvedValue(
      myEntry({
        groupScheme: 'gender_age',
        entry: { ...myEntry().entry!, tier: 'verified', groupKey: 'w_u40' },
        verified: verifiedState({ ownGroup: 'w_u40', groupOptions: ['w_u40'] }),
        result: result({
          status: 'provisional',
          elapsedSec: 6125,
          place: 3,
          ranked: 9,
          group: 'w_u40',
        }),
      }),
    );
    await open();

    expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();
    expect(participation().getByText('Verified · Женщины до 40')).toBeOnTheScreen();
    expect(
      await participation().findByText(
        'Предварительно 3-е место в группе «Женщины до 40» до публикации протокола 14 октября.',
      ),
    ).toBeOnTheScreen();
  });

  it.each([
    ['start', 'START', 'Уровень START: время без места в зачёте.'],
    [
      'no_heart_rate',
      'Verified · Мужчины 40–49',
      'Без пульса — вне зачёта. Место в группе — только с пульсом в треке.',
    ],
  ] as const)(
    'finisher (%s) — время, «Финишёр», почему без места',
    async (unranked, line, text) => {
      const tier = unranked === 'start' ? 'start' : 'verified';
      getMyRaceEntry.mockResolvedValue(
        myEntry({
          groupScheme: 'gender_age',
          entry: {
            ...myEntry().entry!,
            tier,
            groupKey: tier === 'start' ? 'overall' : 'm_40_49',
          },
          verified: verifiedState(),
          result: result({ status: 'finisher', elapsedSec: 6125, unranked }),
        }),
      );
      await open();

      expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();
      expect(participation().getByText(line)).toBeOnTheScreen();
      expect(participation().getByText('Финишёр')).toBeOnTheScreen();
      expect(participation().getByText('1:42:05')).toBeOnTheScreen();
      expect(await participation().findByText(text)).toBeOnTheScreen();
    },
  );

  it('схема overall — без строки уровня (как раньше)', async () => {
    getMyRaceEntry.mockResolvedValue(myEntry());
    await open();

    expect(await screen.findByText('Ваше участие')).toBeOnTheScreen();
    expect(participation().queryByText(/Verified/)).toBeNull();
  });
});
