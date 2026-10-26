import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import {
  addLocalDays,
  CITY_CODES,
  CreateRideForm,
  minskToday,
  minskWallTimeToUtc,
  RIDE_START_MAX_AHEAD_DAYS,
  RIDE_TITLE_MIN,
  RideQuotaDetails,
  utcToMinskWallTime,
  type CityCode,
  type CreateRideFormOutput,
  type CreateRideFormValues,
  type CreateRideRequest,
  type RideDetailForOrganizer,
} from '@pokatim/contracts';
import { size, space } from '@pokatim/design-tokens';
import { t, type MessageKey } from '@pokatim/i18n';
import {
  Banner,
  Button,
  Chip,
  DateField,
  TextAction,
  TextField,
  textStyle,
  useTheme,
} from '@rkarakulov/ui';
import { useRouter } from 'expo-router';
import { useState, type ComponentProps } from 'react';
import { Controller, useForm, useWatch } from 'react-hook-form';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DetailHeader } from '@/components/detail-header';
import { DocumentTitle } from '@/components/document-title';
import { retryAfterSec, serverFieldErrors } from '@/features/auth/error-messages';

import { sortCitiesByLabel } from './filters';
import { cityLabel } from './format';
import { useCreateRide, useUpdateRide } from './queries';

type FieldName = keyof CreateRideFormValues;

const FORM_FIELDS = [
  'title',
  'organizerName',
  'date',
  'time',
  'cityCode',
  'place',
  'distanceKm',
  'paceMinKmh',
  'paceMaxKmh',
  'limit',
  'description',
] as const satisfies readonly FieldName[];

/** Поля ответа сервера → поля формы (`startsAt` — под «Дата»). */
const SERVER_FIELDS = [...FORM_FIELDS, 'startsAt'] as const;
const formFieldOf = (path: (typeof SERVER_FIELDS)[number]): FieldName =>
  path === 'startsAt' ? 'date' : path;

/** Видимых городов до «Все города» [ASSUMPTION до компонента `Picker` базы]. */
const COLLAPSED_CITIES = 8;
const SORTED_CITIES = sortCitiesByLabel(CITY_CODES);

const emptyForm = (): CreateRideFormValues => ({
  title: '',
  organizerName: '',
  date: '',
  time: '',
  cityCode: undefined as unknown as CityCode,
  place: '',
  distanceKm: '',
  paceMinKmh: '',
  paceMaxKmh: '',
  limit: '',
  description: '',
});

/** Значения формы правки из карточки организатора. */
export function rideFormOf(ride: RideDetailForOrganizer): CreateRideFormValues {
  const wall = utcToMinskWallTime(ride.startsAt);
  return {
    title: ride.title,
    organizerName: ride.organizerName ?? '',
    date: wall.slice(0, 10),
    time: wall.slice(11, 16),
    cityCode: ride.city === 'unknown' ? (undefined as unknown as CityCode) : ride.city,
    place: ride.place,
    distanceKm: String(ride.distanceKm),
    paceMinKmh: String(ride.paceMinKmh),
    paceMaxKmh: String(ride.paceMaxKmh),
    limit: ride.limit === null ? '' : String(ride.limit),
    description: ride.description ?? '',
  };
}

/** Запрос из значений формы: дата и время Минска → `startsAt` UTC (`minskWallTimeToUtc`). */
export function rideRequestOf(values: CreateRideFormOutput): CreateRideRequest {
  const { date, time, ...fields } = values;
  return { ...fields, startsAt: minskWallTimeToUtc(`${date}T${time}`) };
}

/** Маска времени «ЧЧ:ММ»: только цифры, двоеточие после часов (фолбэк до `TimeField` базы, §8.2 O1). */
export function maskTime(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
}

/** Текст ошибки поля по коду (сообщение zod = код); дата в прошлом — свой текст. */
function fieldText(code: string | undefined, dateInPast: boolean): string | undefined {
  if (code === undefined) return undefined;
  if (code === 'RIDE_START_IN_PAST' && dateInPast) return t('field.error.RIDE_START_IN_PAST_DATE');
  const key = `field.error.${code}` as MessageKey;
  const text = t(key, { min: RIDE_TITLE_MIN });
  return text === key ? t('field.error.INVALID') : text;
}

/** Текст отказа сохранения (баннер над кнопкой): 429, квота, сеть, прочее. */
function failureText(error: unknown): string {
  if (isNetworkError(error)) return t('rides.error.network');
  const apiError = apiErrorOf(error);
  if (apiError?.code === 'RATE_LIMITED') {
    return t('rides.error.rateLimited', { seconds: retryAfterSec(error) ?? 60 });
  }
  if (apiError?.code === 'RIDE_QUOTA_EXCEEDED') {
    const details = RideQuotaDetails.safeParse(apiError.details);
    const count = details.success ? details.data.limit : 5;
    return details.success && details.data.quota === 'joined'
      ? t('rides.form.quotaJoined', { count })
      : t('rides.form.quota', { count });
  }
  return t('rides.form.failed');
}

/** Выбор города: одиночный, чипы по алфавиту; свёрнуто до 8 + «Все города» (выбранный — всегда виден). */
function CityPicker({
  value,
  onChange,
  error,
}: {
  value: CityCode | undefined;
  onChange: (city: CityCode) => void;
  error: string | undefined;
}) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const visible = expanded
    ? SORTED_CITIES
    : SORTED_CITIES.filter((city, index) => index < COLLAPSED_CITIES || city === value);
  return (
    <View style={styles.field}>
      <Text style={[textStyle('label'), { color: theme.text.secondary }]}>
        {t('rides.form.city')}
      </Text>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {visible.map((city) => (
          <Chip
            key={city}
            label={cityLabel(city) ?? city}
            selected={city === value}
            onPress={() => onChange(city)}
          />
        ))}
      </View>
      {expanded ? null : (
        <View style={styles.start}>
          <TextAction label={t('rides.form.allCities')} onPress={() => setExpanded(true)} />
        </View>
      )}
      {error ? (
        <Text style={[textStyle('meta'), { color: theme.status.error }]}>{error}</Text>
      ) : null}
    </View>
  );
}

/**
 * Форма «Новый райд» / «Изменить райд» (§3): react-hook-form + `zodResolver(CreateRideForm)` (та же схема
 * contracts); дата в прошлом — ошибка под датой и выключенная «Опубликовать» с причиной; ошибки полей сервера —
 * под полями (`startsAt` — под «Дата»); 409 — «Райд изменили» + «Обновить»; 429 и квота — баннер. Время, описание и
 * единицы — фолбэк до релиза базы (§8.2 O1). Выход без сохранения — без подтверждения [ASSUMPTION].
 */
export function RideFormScreen({
  ride,
  onReload,
}: {
  /** Правка: карточка организатора (с `version`); нет — создание. */
  ride?: RideDetailForOrganizer;
  /** Правка: перезагрузить райд после 409 (`CONFLICT`). */
  onReload?: () => Promise<RideDetailForOrganizer | undefined>;
}) {
  const theme = useTheme();
  const router = useRouter();
  const create = useCreateRide();
  const update = useUpdateRide(ride?.id ?? '');
  const mutation = ride ? update : create;
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState<string>();
  const today = minskToday();
  const title = t(ride ? 'rides.form.editTitle' : 'rides.form.newTitle');

  const form = useForm<CreateRideFormValues, unknown, CreateRideFormOutput>({
    resolver: zodResolver(CreateRideForm),
    mode: 'onTouched',
    defaultValues: ride ? rideFormOf(ride) : emptyForm(),
  });
  const { errors } = form.formState;
  const date = useWatch({ control: form.control, name: 'date' });
  const dateInPast = /^\d{4}-\d{2}-\d{2}$/.test(date ?? '') && date < today;
  const errorOf = (name: FieldName) => fieldText(errors[name]?.message, dateInPast);
  const dateError = dateInPast ? t('field.error.RIDE_START_IN_PAST_DATE') : errorOf('date');

  const onSubmit = form.handleSubmit(async (values) => {
    setFailure(undefined);
    setConflict(false);
    const body = rideRequestOf(values);
    try {
      const view = ride
        ? await update.mutateAsync({ ...body, version: ride.version })
        : await create.mutateAsync(body);
      router.replace(ride ? `/rides/${view.ride.id}` : `/rides/${view.ride.id}?published=1`);
    } catch (error) {
      if (apiErrorOf(error)?.code === 'CONFLICT') return setConflict(true);
      const fields = serverFieldErrors(error, SERVER_FIELDS);
      if (fields.length > 0) {
        for (const { field, code } of fields) {
          form.setError(formFieldOf(field), { type: 'server', message: code });
        }
        return;
      }
      setFailure(failureText(error));
    }
  });

  const reload = async () => {
    const fresh = await onReload?.();
    if (fresh) form.reset(rideFormOf(fresh));
    setConflict(false);
  };

  const text = (
    name: Exclude<FieldName, 'date' | 'cityCode'>,
    label: MessageKey,
    extra: Partial<ComponentProps<typeof TextField>> = {},
  ) => (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <TextField
          label={t(label)}
          value={field.value ?? ''}
          onChangeText={
            name === 'time' ? (value) => field.onChange(maskTime(value)) : field.onChange
          }
          onBlur={field.onBlur}
          error={errorOf(name)}
          {...extra}
        />
      )}
    />
  );

  return (
    <SafeAreaView
      edges={['top']}
      style={[styles.safeArea, { backgroundColor: theme.surface.default }]}
    >
      <DocumentTitle title={`${title} — ${t('app.name')}`} />
      <DetailHeader title={title} fallback={ride ? `/rides/${ride.id}` : '/rides'} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {conflict ? (
          <View style={styles.stack}>
            <Banner tone="warning" message={t('rides.form.conflict')} />
            <View style={styles.start}>
              <TextAction label={t('rides.form.reload')} onPress={() => void reload()} />
            </View>
          </View>
        ) : null}
        {text('title', 'rides.form.title', { autoCorrect: true })}
        {text('organizerName', 'rides.form.organizerName', {
          helper: t('rides.form.organizerNameHelper'),
          autoComplete: 'off',
        })}
        <Controller
          control={form.control}
          name="date"
          render={({ field }) => (
            <DateField
              label={t('rides.form.date')}
              value={field.value || undefined}
              onChange={field.onChange}
              onBlur={field.onBlur}
              minimumDate={today}
              maximumDate={addLocalDays(today, RIDE_START_MAX_AHEAD_DAYS)}
              error={dateError}
            />
          )}
        />
        {text('time', 'rides.form.time', {
          helper: t('rides.form.timeHelper'),
          keyboardType: 'number-pad',
          placeholder: '09:30',
        })}
        <Controller
          control={form.control}
          name="cityCode"
          render={({ field }) => (
            <CityPicker value={field.value} onChange={field.onChange} error={errorOf('cityCode')} />
          )}
        />
        {text('place', 'rides.form.place', { helper: t('rides.form.placeHelper') })}
        {text('distanceKm', 'rides.form.distance', { keyboardType: 'number-pad' })}
        <View style={styles.row}>
          <View style={styles.cell}>
            {text('paceMinKmh', 'rides.form.paceMin', { keyboardType: 'number-pad' })}
          </View>
          <View style={styles.cell}>
            {text('paceMaxKmh', 'rides.form.paceMax', { keyboardType: 'number-pad' })}
          </View>
        </View>
        {text('description', 'rides.form.description')}
        {text('limit', 'rides.form.limit', {
          keyboardType: 'number-pad',
          placeholder: t('rides.form.limitPlaceholder'),
        })}
        <View style={styles.stack}>
          {failure ? <Banner tone="error" message={failure} /> : null}
          <Button
            label={t(ride ? 'rides.form.save' : 'rides.form.publish')}
            onPress={() => void onSubmit()}
            disabled={dateInPast}
            loading={mutation.isPending}
          />
          {dateInPast ? (
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {t('rides.form.dateReason')}
            </Text>
          ) : null}
          {ride ? null : (
            <Text style={[textStyle('meta'), { color: theme.text.secondary }]}>
              {t('rides.form.hint')}
            </Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  content: { paddingHorizontal: size.gutter, paddingBottom: space.s6, gap: space.s4 },
  field: { gap: space.s2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.s2 },
  start: { alignItems: 'flex-start' },
  stack: { gap: space.s2 },
  row: { flexDirection: 'row', gap: space.s3 },
  cell: { flex: 1 },
});
