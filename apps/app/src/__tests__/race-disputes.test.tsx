/// <reference types="jest" />
import { ApiHttpError } from '@pokatim/api-client';
import { onlineManager } from '@tanstack/react-query';
import { fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';

import { useSessionStore } from '@/features/auth/session-store';
import { useOnboardingStore } from '@/features/onboarding/onboarding-store';
import { api } from '@/lib/api';

import RaceRoute from '../app/races/[id]';
import DisputeResponseRoute from '../app/races/dispute-response/[id]/[disputeId]';
import FileDisputeRoute from '../app/races/dispute/[id]/[entryId]';
import RivalResultRoute from '../app/races/result/[id]/[entryId]';
import { appRoutes, tabRoutes } from './app-routes';
import { liveSession } from './auth-fixtures';
import { against, DISPUTE_ID, filed, myDisputes, RIVAL_ENTRY_ID } from './disputes-fixtures';
import { createQueryWrapper } from './query-wrapper';
import {
  corridorRace,
  ENTRY_ID,
  myEntry,
  noEntry,
  RACE_ID,
  resultsPage,
  row,
} from './races-fixtures';

jest.mock('@/lib/api');
jest.mock('expo-font', () => ({ useFonts: jest.fn(() => [true, null]) }));

const getRace = jest.mocked(api.getRace);
const getRaceResults = jest.mocked(api.getRaceResults);
const getMyRaceEntry = jest.mocked(api.getMyRaceEntry);
const getMyRaceDisputes = jest.mocked(api.getMyRaceDisputes);
const fileDispute = jest.mocked(api.fileDispute);
const withdrawDispute = jest.mocked(api.withdrawDispute);
const respondToDispute = jest.mocked(api.respondToDispute);

/** «Сейчас»: 9 октября 2026, 21:00 по Минску — приём споров открыт. */
const NOW = new Date('2026-10-09T18:00:00Z');
const TOKEN = liveSession.accessToken;
const THIRD = '0199d000-0000-7000-8000-0000000000f3';
const blocked = (reason: string) =>
  new ApiHttpError(409, { code: 'DISPUTE_ACTION_BLOCKED', message: 'x', details: { reason } });

const rows = [
  row({ entryId: RIVAL_ENTRY_ID, place: 1, elapsedSec: 5400 }),
  row({ entryId: ENTRY_ID, place: 2, elapsedSec: 6125 }),
  row({ entryId: THIRD, place: 3, elapsedSec: 6400 }),
];

const signedIn = () => {
  useSessionStore.setState({ status: 'signedIn', session: liveSession });
  useOnboardingStore.setState({ survey: 'completed', location: 'done', devices: 'done' });
};

const routes = {
  ...tabRoutes,
  'races/[id]': RaceRoute,
  'races/result/[id]/[entryId]': RivalResultRoute,
  'races/dispute/[id]/[entryId]': FileDisputeRoute,
  'races/dispute-response/[id]/[disputeId]': DisputeResponseRoute,
};
/** Вошедший, без корневого layout: клиент запросов без повторов. */
const open = (url = `/races/${RACE_ID}`) => {
  signedIn();
  return renderRouter(routes, { initialUrl: url, wrapper: createQueryWrapper() });
};
const rivalUrl = `/races/result/${RACE_ID}/${RIVAL_ENTRY_ID}`;
const formUrl = `/races/dispute/${RACE_ID}/${RIVAL_ENTRY_ID}`;
const openCard = 'Участник, 1 место, 1:30:00. Открыть карточку';
const disputesBlock = () => within(screen.getByTestId('race-disputes'));
/** Блок «Споры» появляется после ответа «моих споров». */
const block = async () => within(await screen.findByTestId('race-disputes'));

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, advanceTimers: true });
  getRace.mockResolvedValue(corridorRace());
  getRaceResults.mockResolvedValue(resultsPage(rows));
  getMyRaceEntry.mockResolvedValue(myEntry());
  getMyRaceDisputes.mockResolvedValue(myDisputes());
});
afterEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  onlineManager.setOnline(true);
});

describe('строки таблицы (RC-14)', () => {
  it('участник, приём открыт: чужие строки — кнопки, своя — нет; нажатие — карточка соперника', async () => {
    const router = await open();

    const rival = await screen.findByRole('button', { name: openCard });
    expect(
      screen.getByRole('button', { name: 'Участник, 3 место, 1:46:40. Открыть карточку' }),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('2, Вы, 1:42:05')).toBeOnTheScreen();
    expect(getMyRaceDisputes).toHaveBeenCalledWith(TOKEN, RACE_ID);

    await fireEvent.press(rival);
    expect(router.getPathname()).toBe(rivalUrl);
  });

  it('unavailable без моих споров — строки не нажимаемы', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({ status: 'unavailable', reason: 'withdrawn' }));
    await open();

    expect(await screen.findByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
    await waitFor(() => expect(getMyRaceDisputes).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: openCard })).toBeNull();
  });

  it('без заявки — споры не запрашиваются, строки не нажимаемы', async () => {
    getMyRaceEntry.mockResolvedValue(noEntry());
    await open();

    expect(await screen.findByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
    expect(getMyRaceDisputes).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: openCard })).toBeNull();
  });
});

describe('карточка соперника (AC12)', () => {
  it('имя соперника (profile-rider-name) — в кнопке строки и на карточке вместо «Участник»', async () => {
    getRaceResults.mockResolvedValue(
      resultsPage([{ ...rows[0]!, riderName: 'Анна К.' }, ...rows.slice(1)]),
    );
    await open();
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Анна К., 1 место, 1:30:00. Открыть карточку' }),
    );

    expect(await screen.findByText('Анна К.')).toBeOnTheScreen();
    expect(screen.queryByText('Участник')).toBeNull();
  });

  it('open: место, «Участник», время, статус, «Оспорить результат» и срок → форма', async () => {
    const router = await open(rivalUrl);

    expect(await screen.findByText('1 место')).toBeOnTheScreen();
    expect(screen.getByText('Участник')).toBeOnTheScreen();
    expect(screen.getByText('1:30:00')).toBeOnTheScreen();
    expect(screen.getByText('Предварительный')).toBeOnTheScreen();
    expect(
      await screen.findByText('Споры принимаются до 13 октября 2026, 12:00'),
    ).toBeOnTheScreen();
    const action = screen.getByRole('button', { name: 'Оспорить результат' });
    expect(action).toBeEnabled();
    await fireEvent.press(action);
    expect(router.getPathname()).toBe(formUrl);
  });

  it('closed — действие выключено с причиной M1', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({ status: 'closed', reason: 'filing_closed' }));
    await open(rivalUrl);

    expect(
      await screen.findByText(
        'Приём споров закрыт — протокол будет опубликован 14 октября 2026, 12:00',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Оспорить результат' })).toBeDisabled();
  });

  it('мой спор по строке — статус вместо действия; незнакомый статус — нейтрально', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { filed: [filed()] }));
    await open(rivalUrl);

    expect(await screen.findByText('На рассмотрении')).toBeOnTheScreen();
    expect(screen.getByText('Похоже на помощь транспорта')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Оспорить результат' })).toBeNull();
  });

  it('незнакомый статус спора — «Статус обновляется»', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { filed: [filed({ status: 'unknown' })] }));
    await open(rivalUrl);

    expect(await screen.findByText('Статус обновляется')).toBeOnTheScreen();
  });

  it('нет строки в таблице — «Результат не найден» и «К гонке»', async () => {
    getRaceResults.mockResolvedValue(resultsPage([rows[2]!]));
    const router = await open(rivalUrl);

    expect(await screen.findByText('Результат не найден')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'К гонке' }));
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
  });

  it('скелетон, затем ошибка споров — баннер с повтором', async () => {
    getMyRaceDisputes.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    await open(rivalUrl);

    expect(await screen.findByText('1 место')).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('button', { name: 'Оспорить результат' })).toBeOnTheScreen();
  });
});

describe('форма спора (AC12)', () => {
  it('без категории «Отправить спор» выключено с причиной; описание > 2000 — ошибка поля', async () => {
    await open(formUrl);

    expect(await screen.findByText('Оспариваемый результат')).toBeOnTheScreen();
    expect(await screen.findByText('Выберите категорию')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить спор' })).toBeDisabled();
    expect(
      screen.getByText(
        'Участник увидит только категорию — ваше имя и описание видит только команда платформы.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Споры принимаются до 13 октября 2026, 12:00')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Чужой трек или чужой датчик'));
    expect(screen.queryByText('Выберите категорию')).toBeNull();
    expect(screen.getByRole('button', { name: 'Отправить спор' })).toBeEnabled();

    await fireEvent.changeText(screen.getByLabelText('Описание — необязательно'), 'x'.repeat(2001));
    expect(screen.getByText('Слишком длинное значение.')).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить спор' })).toBeDisabled();
  });

  it('409 — текст по details.reason', async () => {
    fileDispute.mockRejectedValue(blocked('already_filed'));
    await open(formUrl);

    await fireEvent.press(await screen.findByText('Другое'));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить спор' }));
    expect(await screen.findByText('Вы уже подавали спор по этому результату')).toBeOnTheScreen();
  });

  it('успех → возврат к карточке гонки, споры и участие перезапрошены', async () => {
    fileDispute.mockResolvedValue(filed());
    const router = await open(formUrl);

    await fireEvent.press(await screen.findByText('Похоже на помощь транспорта'));
    await fireEvent.changeText(screen.getByLabelText('Описание — необязательно'), '  Скорость 70 ');
    const calls = getMyRaceDisputes.mock.calls.length;
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { filed: [filed()] }));
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить спор' }));

    await waitFor(() =>
      expect(fileDispute).toHaveBeenCalledWith(TOKEN, RACE_ID, {
        targetEntryId: RIVAL_ENTRY_ID,
        category: 'vehicle_assistance',
        description: 'Скорость 70',
      }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
    await waitFor(() => expect(getMyRaceDisputes.mock.calls.length).toBeGreaterThan(calls));
    expect(await (await block()).findByText('Мои споры')).toBeOnTheScreen();
  });

  it('приём закрыт — причина вместо формы', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({ status: 'closed', reason: 'open_limit' }));
    await open(formUrl);

    expect(await screen.findByText('У вас уже 3 открытых спора в этой гонке')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Отправить спор' })).toBeNull();
  });
});

describe('блок «Споры» на карточке гонки (AC12)', () => {
  it('нет споров — блока нет', async () => {
    await open();

    await screen.findByRole('button', { name: openCard });
    expect(screen.queryByTestId('race-disputes')).toBeNull();
  });

  it('мои: статусы и исход с шаблоном', async () => {
    getMyRaceDisputes.mockResolvedValue(
      myDisputes(
        {},
        {
          filed: [
            filed({
              id: '0199e000-0000-7000-8000-0000000000d3',
              targetEntryId: THIRD,
              status: 'rejected',
              decision: { outcome: 'rejected', template: 'track_confirmed', at: NOW.toISOString() },
            }),
            filed({ status: 'withdrawn' }),
          ],
        },
      ),
    );
    await open();

    expect(await (await block()).findByText('Отклонён')).toBeOnTheScreen();
    expect(disputesBlock().getByText('Отклонён: Трек проверен — нарушений нет')).toBeOnTheScreen();
    expect(disputesBlock().getByText('Отозван')).toBeOnTheScreen();
    expect(disputesBlock().queryByRole('button', { name: 'Отозвать спор' })).toBeNull();
  });

  it('«Отозвать спор» → подтверждение → withdrawDispute; «Не отзывать» — без запроса', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { filed: [filed()] }));
    withdrawDispute.mockResolvedValue(filed({ status: 'withdrawn' }));
    await open();

    await fireEvent.press(await (await block()).findByRole('button', { name: 'Отозвать спор' }));
    expect(screen.getByText('Отозвать спор?')).toBeOnTheScreen();
    expect(screen.getByText('Подать его снова будет нельзя.')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Не отзывать' }));
    expect(screen.queryByText('Отозвать спор?')).toBeNull();
    expect(withdrawDispute).not.toHaveBeenCalled();

    await fireEvent.press(disputesBlock().getByRole('button', { name: 'Отозвать спор' }));
    getMyRaceDisputes.mockResolvedValue(
      myDisputes({}, { filed: [filed({ status: 'withdrawn' })] }),
    );
    await fireEvent.press(disputesBlock().getByRole('button', { name: 'Отозвать спор' }));
    expect(withdrawDispute).toHaveBeenCalledWith(TOKEN, DISPUTE_ID);
    expect(await (await block()).findByText('Отозван')).toBeOnTheScreen();
    expect(screen.queryByText('Отозвать спор?')).toBeNull();
  });

  it('отзыв 409 not_open — текст', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { filed: [filed()] }));
    withdrawDispute.mockRejectedValue(blocked('not_open'));
    await open();

    await fireEvent.press(await (await block()).findByRole('button', { name: 'Отозвать спор' }));
    await fireEvent.press(disputesBlock().getByRole('button', { name: 'Отозвать спор' }));
    expect(await screen.findByText('Спор уже закрыт')).toBeOnTheScreen();
  });

  it('по моему результату: баннер с категорией и сроком, «Ответить» → экран ответа', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { against: [against()] }));
    const router = await open();

    expect(
      await (
        await block()
      ).findByText(
        'По вашему результату открыт спор: Скорость не соответствует пульсу. Решение — до публикации протокола 14 октября 2026, 12:00',
      ),
    ).toBeOnTheScreen();
    await fireEvent.press(disputesBlock().getByRole('button', { name: 'Ответить' }));
    expect(router.getPathname()).toBe(`/races/dispute-response/${RACE_ID}/${against().id}`);
  });

  it('ответ отправлен; решённый — исход', async () => {
    getMyRaceDisputes.mockResolvedValue(
      myDisputes(
        {},
        {
          against: [
            against({ canRespond: false, response: { text: 'Мой трек', at: NOW.toISOString() } }),
            against({
              id: '0199e000-0000-7000-8000-0000000000d4',
              status: 'upheld',
              canRespond: false,
              decision: {
                outcome: 'upheld',
                template: 'vehicle_assistance',
                at: NOW.toISOString(),
              },
            }),
          ],
        },
      ),
    );
    await open();

    expect(await (await block()).findByText('Ваш ответ отправлен')).toBeOnTheScreen();
    expect(disputesBlock().queryByRole('button', { name: 'Ответить' })).toBeNull();
    expect(
      disputesBlock().getByText(
        'Спор по вашему результату: Удовлетворён. Есть признаки помощи транспорта',
      ),
    ).toBeOnTheScreen();
  });

  it('ошибка споров — баннер с повтором, карточка видна', async () => {
    getMyRaceDisputes.mockRejectedValueOnce(
      new ApiHttpError(500, { code: 'INTERNAL', message: 'x' }),
    );
    await open();

    expect(await screen.findByText('Не удалось загрузить')).toBeOnTheScreen();
    expect(screen.getByText('±50 м от маршрута')).toBeOnTheScreen();
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { filed: [filed()] }));
    await fireEvent.press(screen.getByRole('button', { name: 'Повторить' }));
    expect(await (await block()).findByText('Мои споры')).toBeOnTheScreen();
  });
});

describe('ответ на спор (AC12)', () => {
  const responseUrl = `/races/dispute-response/${RACE_ID}/${against().id}`;

  it('ответ: пусто — выключено, короче 3 — ошибка; отправка → respondToDispute и возврат', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { against: [against()] }));
    respondToDispute.mockResolvedValue(
      against({ canRespond: false, response: { text: 'Трек мой', at: NOW.toISOString() } }),
    );
    const router = await open(responseUrl);

    expect(
      await screen.findByText('Ответ увидит только команда платформы. Ответить можно один раз.'),
    ).toBeOnTheScreen();
    expect(screen.getByRole('button', { name: 'Отправить ответ' })).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Ваш ответ'), 'ok');
    expect(screen.getByText('Не короче 3 символов.')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Ваш ответ'), ' Трек мой, без помощи ');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить ответ' }));

    await waitFor(() =>
      expect(respondToDispute).toHaveBeenCalledWith(TOKEN, against().id, {
        text: 'Трек мой, без помощи',
      }),
    );
    await waitFor(() => expect(router.getPathname()).toBe(`/races/${RACE_ID}`));
  });

  it('409 already_responded — текст', async () => {
    getMyRaceDisputes.mockResolvedValue(myDisputes({}, { against: [against()] }));
    respondToDispute.mockRejectedValue(blocked('already_responded'));
    await open(responseUrl);

    await fireEvent.changeText(await screen.findByLabelText('Ваш ответ'), 'Трек мой');
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить ответ' }));
    expect(await screen.findByText('Вы уже ответили на этот спор')).toBeOnTheScreen();
  });

  it('нет спора — «Спор не найден»', async () => {
    await open(responseUrl);

    expect(await screen.findByText('Спор не найден')).toBeOnTheScreen();
  });
});

describe('гость (RC-14)', () => {
  it('таблица без кнопок, споры не запрашиваются', async () => {
    await renderRouter(appRoutes, { initialUrl: `/races/${RACE_ID}` });

    expect(await screen.findByLabelText('1, Участник, 1:30:00')).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: openCard })).toBeNull();
    expect(getMyRaceDisputes).not.toHaveBeenCalled();
  });

  it.each([rivalUrl, formUrl, `/races/dispute-response/${RACE_ID}/${DISPUTE_ID}`])(
    '%s — под гардом: гостю регистрация',
    async (url) => {
      const router = await renderRouter(appRoutes, { initialUrl: url });

      await waitFor(() => expect(router.getPathname()).toBe('/register'));
      expect(getMyRaceDisputes).not.toHaveBeenCalled();
    },
  );
});
