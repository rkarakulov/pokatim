import { Module } from '@nestjs/common';

import { ImageProcessing, ImageUploadSlots } from './image-processing';

/**
 * Инфраструктура изображений (ADR-0028) — модуль-лист: без коллекций и без импортов `modules/*` (правило
 * `media-leaf`). Не `@Global`: импортируют `ProfileModule` и `RidesModule`; статический модуль Nest создаёт один раз —
 * оба получают **один** гейт обработки и **одни** слоты приёма. В worker не импортируется (рендер карточек — очередь
 * `story-card` с `concurrency: 1`; ему нужны только чистые функции `image-pipeline`).
 */
@Module({
  providers: [ImageProcessing, ImageUploadSlots],
  exports: [ImageProcessing, ImageUploadSlots],
})
export class MediaModule {}
