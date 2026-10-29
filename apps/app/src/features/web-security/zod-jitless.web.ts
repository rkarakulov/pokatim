import { z } from 'zod';

// Строгий CSP web (ADR-0025): без `unsafe-eval`. zod 4 проверяет JIT через `new Function` в try/catch — исключение
// гасится, но браузер всё равно фиксирует нарушение `script-src` на каждой странице. `jitless` — без проверки и JIT.
z.config({ jitless: true });
