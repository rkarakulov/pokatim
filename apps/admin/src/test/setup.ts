import { configure } from '@testing-library/react';
import { vi } from 'vitest';

// Тесты панели не ходят в сеть: данные — заглушки `api` (vi.mock). Случайный реальный запрос — явная ошибка теста,
// а не тихий `ApiNetworkError` из-за отсутствия API.
vi.stubGlobal('fetch', (input: unknown) => {
  throw new Error(`тесты admin не ходят в сеть: ${String(input)} — замокайте api`);
});

// Срок `findBy*`/`waitFor` — опрос условия, которое на заглушках наступает всегда: 1 с по умолчанию RTL
// не переживает `pnpm check` под нагрузкой (тест панели в 10–20 раз медленнее, чем в простое). Один срок на всё —
// без локальных `{ timeout }` и `vi.waitFor` (у него свой срок 1 с); ниже `testTimeout` (vite.config.ts), чтобы
// зависшее условие падало своим сообщением.
configure({ asyncUtilTimeout: 15_000 });
