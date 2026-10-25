import { describe, expect, it } from 'vitest';

import {
  CompleteDevicesStepRequest,
  OnboardingStatus,
  RIDE_REASONS,
  RideReason,
  SubmitOnboardingSurveyRequest,
} from './onboarding.schema.ts';

const fieldCodes = (input: unknown) => {
  const result = SubmitOnboardingSurveyRequest.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
};

describe('RideReason', () => {
  it('коды ответа — в порядке экрана; новые только добавляются в конец (R7)', () => {
    expect(RIDE_REASONS).toEqual(['races', 'group_rides', 'routes', 'calendar', 'exploring']);
    expect(RideReason.safeParse('other').success).toBe(false);
  });
});

describe('SubmitOnboardingSurveyRequest', () => {
  it('один вариант и все варианты сразу', () => {
    expect(SubmitOnboardingSurveyRequest.parse({ reasons: ['routes'] })).toEqual({
      reasons: ['routes'],
    });
    expect(SubmitOnboardingSurveyRequest.parse({ reasons: [...RIDE_REASONS] })).toEqual({
      reasons: [...RIDE_REASONS],
    });
  });

  it('пустой массив и отсутствие ответа — REQUIRED', () => {
    expect(fieldCodes({ reasons: [] })).toEqual([['reasons', 'REQUIRED']]);
    expect(fieldCodes({})).toEqual([['reasons', 'REQUIRED']]);
  });

  it('неизвестное значение, повтор, не-массив, объект-оператор — ошибка', () => {
    expect(fieldCodes({ reasons: ['races', 'other'] })).toEqual([['reasons.1', 'INVALID']]);
    expect(fieldCodes({ reasons: ['races', 'races'] })).toEqual([['reasons', 'INVALID']]);
    expect(fieldCodes({ reasons: 'races' })).toEqual([['reasons', 'REQUIRED']]);
    expect(SubmitOnboardingSurveyRequest.safeParse({ reasons: { $ne: null } }).success).toBe(false);
    expect(SubmitOnboardingSurveyRequest.safeParse({ reasons: [{ $gt: '' }] }).success).toBe(false);
  });

  it('лишний ключ — ошибка', () => {
    expect(
      SubmitOnboardingSurveyRequest.safeParse({ reasons: ['races'], userId: 'x' }).success,
    ).toBe(false);
  });
});

describe('OnboardingStatus', () => {
  it('только признак «опрос пройден», boolean', () => {
    expect(OnboardingStatus.parse({ surveyCompleted: true })).toEqual({ surveyCompleted: true });
    expect(OnboardingStatus.safeParse({ surveyCompleted: 'yes' }).success).toBe(false);
    expect(OnboardingStatus.safeParse({}).success).toBe(false);
  });
});

describe('шаг «Подключите устройство»', () => {
  it('devicesStepCompleted — необязательное поле ответа (старый API)', () => {
    expect(OnboardingStatus.parse({ surveyCompleted: true })).toEqual({ surveyCompleted: true });
    expect(OnboardingStatus.parse({ surveyCompleted: true, devicesStepCompleted: false })).toEqual({
      surveyCompleted: true,
      devicesStepCompleted: false,
    });
    expect(
      OnboardingStatus.safeParse({ surveyCompleted: true, devicesStepCompleted: 'no' }).success,
    ).toBe(false);
  });

  it('исход шага — connected | later, строго', () => {
    expect(CompleteDevicesStepRequest.parse({ outcome: 'later' })).toEqual({ outcome: 'later' });
    expect(CompleteDevicesStepRequest.safeParse({ outcome: 'skip' }).success).toBe(false);
    expect(CompleteDevicesStepRequest.safeParse({}).success).toBe(false);
    expect(
      CompleteDevicesStepRequest.safeParse({ outcome: 'later', completed: true }).success,
    ).toBe(false);
  });
});
