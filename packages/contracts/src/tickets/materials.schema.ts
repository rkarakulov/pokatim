import { z } from 'zod';

import {
  fieldError,
  MULTI_LINE,
  optionalText,
  SINGLE_LINE,
  tolerantEnum,
  Uuid,
  Version,
} from '../common.ts';
import { OpaqueToken } from '../auth/verification.schema.ts';
import { RegistrationUrl } from '../calendar/calendar.schema.ts';

/**
 * Материалы события (event-tickets PR C, ADR-0023): ссылки, текст и PDF организатора — на билете, в письме и в
 * карточке события. `type` — тема-подпись (иконка, заголовок); содержимое — одно из: https-ссылка, PDF или только
 * текст (RC-C5). Справочник — только в конец; в ответах приложения — `tolerantEnum`.
 */
export const EVENT_MATERIAL_TYPES = [
  'rules',
  'what_to_bring',
  'clothing',
  'route',
  'safety',
  'gpx',
  'parking',
  'start_procedure',
  'nutrition',
  'weather',
  'pdf',
  'link',
  'text',
] as const;
export const EventMaterialType = z.enum(EVENT_MATERIAL_TYPES, { error: fieldError('INVALID') });
export type EventMaterialType = z.infer<typeof EventMaterialType>;

export const EVENT_MATERIAL_TITLE_MAX = 120;
export const EVENT_MATERIAL_DESCRIPTION_MAX = 1000;
/** Материалов у события — не больше 20, из них PDF — не больше 10. */
export const EVENT_MATERIALS_MAX = 20;
export const EVENT_MATERIAL_FILES_MAX = 10;
/** PDF — не больше 10 МиБ (`413 MATERIAL_FILE_TOO_LARGE`). */
export const EVENT_MATERIAL_FILE_MAX_BYTES = 10 * 1024 * 1024;
export const EVENT_MATERIAL_FILE_NAME_MAX = 120;
/**
 * Описание при загрузке PDF (метаданные — в query) — не больше 500: строка запроса и в худшем UTF-8 (3 байта на символ,
 * `%XX` на байт) остаётся в 8 КБ буфера заголовков nginx. Длиннее — правкой материала после загрузки (JSON, до 1000).
 */
export const EVENT_MATERIAL_UPLOAD_DESCRIPTION_MAX = 500;

/** Темы только со ссылкой; `text` — только текст; `pdf` — только файл (загрузкой). */
const URL_ONLY_TYPES: readonly EventMaterialType[] = ['link', 'gpx'];
/** Темы, которые нельзя загрузить файлом. */
export const EVENT_MATERIAL_NON_FILE_TYPES: readonly EventMaterialType[] = [
  ...URL_ONLY_TYPES,
  'text',
];

export interface MaterialContent {
  type: EventMaterialType;
  url: string | null;
  description: string | null;
  hasFile: boolean;
}
export interface MaterialContentIssue {
  path: 'type' | 'url' | 'description';
  code: 'REQUIRED' | 'INVALID';
}

/**
 * Правила содержимого (RC-C5) — одни для формы панели, контракта и сервера: `link`/`gpx` — только ссылка, `text` —
 * только описание, `pdf` — только файл; остальные темы — ссылка, файл или только текст (тогда описание обязательно).
 */
export function materialContentIssues(content: MaterialContent): MaterialContentIssue[] {
  const { type, url, description, hasFile } = content;
  // файл есть только у `pdf` и тем «ссылка, файл или текст»
  if (hasFile && EVENT_MATERIAL_NON_FILE_TYPES.includes(type))
    return [{ path: 'type', code: 'INVALID' }];
  if (URL_ONLY_TYPES.includes(type)) return url === null ? [{ path: 'url', code: 'REQUIRED' }] : [];
  if (type === 'pdf') return hasFile && url === null ? [] : [{ path: 'type', code: 'INVALID' }];
  if (type === 'text') {
    if (url !== null) return [{ path: 'url', code: 'INVALID' }];
    return description === null ? [{ path: 'description', code: 'REQUIRED' }] : [];
  }
  if (url !== null && hasFile) return [{ path: 'url', code: 'INVALID' }];
  if (url === null && !hasFile && description === null) {
    return [{ path: 'description', code: 'REQUIRED' }];
  }
  return [];
}

const MaterialTitle = z
  .string({ error: fieldError('REQUIRED') })
  .trim()
  .min(1, { error: 'REQUIRED', abort: true })
  .max(EVENT_MATERIAL_TITLE_MAX, { error: 'TOO_LONG' })
  .regex(SINGLE_LINE, { error: 'INVALID' });
const MaterialDescription = optionalText(EVENT_MATERIAL_DESCRIPTION_MAX, MULTI_LINE);

/** Id файла (`GET /v1/event-files/:id`): случайный токен 43 символа, не id материала. */
export const EventMaterialFileId = OpaqueToken;
export type EventMaterialFileId = z.infer<typeof EventMaterialFileId>;

export const EventMaterialFile = z.object({
  id: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
});
export type EventMaterialFile = z.infer<typeof EventMaterialFile>;

const material = <T extends z.ZodType>(type: T) =>
  z.object({
    id: z.uuid(),
    type,
    title: z.string(),
    description: z.string().nullable(),
    url: z.string().nullable(),
    file: EventMaterialFile.nullable(),
  });

/**
 * Материал в ответах приложения (`GET /v1/events/:kind/:eventId/materials`, `TicketView.materials`): порядок массива —
 * порядок показа; без версии, дат и сотрудников.
 */
export const EventMaterial = material(tolerantEnum(EVENT_MATERIAL_TYPES));
export type EventMaterial = z.infer<typeof EventMaterial>;
export const EventMaterialList = z.array(EventMaterial);
export type EventMaterialList = z.infer<typeof EventMaterialList>;

/** Материал в панели (строгий справочник) + версия для правки. */
export const EventMaterialAdmin = material(z.enum(EVENT_MATERIAL_TYPES)).extend({
  version: z.number().int().nonnegative(),
  updatedAt: z.iso.datetime(),
});
export type EventMaterialAdmin = z.infer<typeof EventMaterialAdmin>;

/** `GET /v1/admin/events/:kind/:eventId/materials` — по порядку; остаток лимитов материалов и PDF. */
export const EventMaterialsAdmin = z.object({
  items: z.array(EventMaterialAdmin),
  itemsLeft: z.number().int().nonnegative(),
  filesLeft: z.number().int().nonnegative(),
});
export type EventMaterialsAdmin = z.infer<typeof EventMaterialsAdmin>;

const addIssues = (
  content: MaterialContent,
  ctx: { addIssue: (issue: { code: 'custom'; path: string[]; message: string }) => void },
) => {
  for (const issue of materialContentIssues(content)) {
    ctx.addIssue({ code: 'custom', path: [issue.path], message: issue.code });
  }
};

/** `POST /v1/admin/events/:kind/:eventId/materials` — ссылка или текст; PDF — только загрузкой (`…/materials/files`). */
export const EventMaterialInput = z
  .strictObject({
    type: EventMaterialType,
    title: MaterialTitle,
    description: MaterialDescription,
    url: RegistrationUrl.nullable(),
  })
  .superRefine((value, ctx) => addIssues({ ...value, hasFile: false }, ctx));
export type EventMaterialInput = z.infer<typeof EventMaterialInput>;

/**
 * `PATCH …/materials/:id` — изменённые поля + ожидаемая `version` (устаревшая — `409 CONFLICT`). Файл не меняется;
 * правила RC-C5 по итоговому документу — сервер.
 */
export const UpdateEventMaterialRequest = z.strictObject({
  type: EventMaterialType.optional(),
  title: MaterialTitle.optional(),
  description: MaterialDescription.optional(),
  url: RegistrationUrl.nullable().optional(),
  version: Version,
});
export type UpdateEventMaterialRequest = z.infer<typeof UpdateEventMaterialRequest>;

/**
 * Query `POST …/materials/files` (тело — PDF `application/octet-stream`): материал создаётся вместе с файлом (RC-C6).
 * Имя файла сервер нормализует.
 */
export const EventMaterialUploadQuery = z.strictObject({
  type: EventMaterialType.refine((type) => !EVENT_MATERIAL_NON_FILE_TYPES.includes(type), {
    error: 'INVALID',
  }),
  title: MaterialTitle,
  description: optionalText(EVENT_MATERIAL_UPLOAD_DESCRIPTION_MAX, MULTI_LINE).optional(),
  fileName: z
    .string({ error: fieldError('REQUIRED') })
    .trim()
    .min(1, { error: 'REQUIRED', abort: true })
    .max(EVENT_MATERIAL_FILE_NAME_MAX, { error: 'TOO_LONG' })
    .regex(SINGLE_LINE, { error: 'INVALID' }),
});
export type EventMaterialUploadQuery = z.infer<typeof EventMaterialUploadQuery>;

/** `PUT …/materials/order` — полный набор id материалов события в новом порядке (иначе `409 CONFLICT`). */
export const ReorderEventMaterialsRequest = z.strictObject({
  ids: z
    .array(Uuid)
    .min(1, { error: 'REQUIRED' })
    .max(EVENT_MATERIALS_MAX, { error: 'INVALID' })
    .refine((ids) => new Set(ids).size === ids.length, { error: 'INVALID' }),
});
export type ReorderEventMaterialsRequest = z.infer<typeof ReorderEventMaterialsRequest>;

/** Путь `…/materials/:materialId`. */
export const EventMaterialParams = z.strictObject({
  kind: z.enum(['race', 'calendar'], { error: fieldError('INVALID') }),
  eventId: Uuid,
  materialId: Uuid,
});
export type EventMaterialParams = z.infer<typeof EventMaterialParams>;
