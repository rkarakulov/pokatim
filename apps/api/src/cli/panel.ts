import { cliEnv } from '../config/env';
import { runPanelCli } from './panel-cli';

/**
 * `node dist/cli/panel.js grant-admin --email … --name …` (прод: `dc exec api …`), dev — `pnpm --filter
 * @pokatim/api panel …`. Сбой — код 1 без стека и данных запроса.
 */
runPanelCli(process.argv.slice(2), () => cliEnv.load(), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
}).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(
      `panel: сбой — ${error instanceof Error ? error.name : 'ошибка'}. Проверьте MONGO_URL и доступ к БД.\n`,
    );
    process.exitCode = 1;
  },
);
