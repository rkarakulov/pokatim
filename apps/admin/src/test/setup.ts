import { vi } from 'vitest';

// Тесты панели не ходят в сеть: данные — заглушки `api` (vi.mock). Случайный реальный запрос — явная ошибка теста,
// а не тихий `ApiNetworkError` из-за отсутствия API.
vi.stubGlobal('fetch', (input: unknown) => {
  throw new Error(`тесты admin не ходят в сеть: ${String(input)} — замокайте api`);
});
