import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { NestFactory } from '@nestjs/core';
import { DisplayName, Email } from '@pokatim/contracts';

import type { CliEnv } from '../config/env';
import { PanelMembersService } from '../modules/panel';
import { PanelCliModule } from './panel-cli.module';

export const CLI_USAGE = `Панель «Протокол» — команды сервера.

  grant-admin --email <e-mail> --name <имя в панели>
      Роль «администратор» существующему пользователю приложения с подтверждённым e-mail
      (первый и аварийный администратор). Запись журнала — с актором cli.

Коды выхода: 0 — готово (или уже администратор), 2 — неверные аргументы или пользователь не подходит, 1 — сбой.
`;

export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

/**
 * CLI панели (`node dist/cli/panel.js …`, ADR-0009): разбирает аргументы, поднимает контекст без HTTP и выполняет
 * команду. Вывод — без персональных данных: e-mail не печатается, только id пользователя.
 */
export async function runPanelCli(argv: string[], env: () => CliEnv, io: CliIo): Promise<number> {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(argv);
  } catch {
    io.stderr(`Неверные аргументы.\n\n${CLI_USAGE}`);
    return 2;
  }
  const [command] = parsed.positionals;
  if (parsed.values.help || command === undefined) {
    io.stdout(CLI_USAGE);
    return command === undefined && !parsed.values.help ? 2 : 0;
  }
  if (command !== 'grant-admin' || parsed.positionals.length > 1) {
    io.stderr(`Неизвестная команда.\n\n${CLI_USAGE}`);
    return 2;
  }
  const email = Email.safeParse(parsed.values.email);
  const name = DisplayName.safeParse(parsed.values.name);
  if (!email.success || !name.success) {
    io.stderr('Нужны --email (адрес) и --name (имя в панели, 1–80 символов).\n');
    return 2;
  }

  const app = await NestFactory.createApplicationContext(PanelCliModule.forRoot(env()), {
    logger: ['error'],
  });
  try {
    const result = await app.get(PanelMembersService).grantAdminFromCli(email.data, name.data);
    switch (result.state) {
      case 'granted':
        io.stdout(`Роль «администратор» выдана. Пользователь: ${result.userId}\n`);
        return 0;
      case 'alreadyAdmin':
        io.stdout(`Пользователь уже администратор: ${result.userId}\n`);
        return 0;
      case 'notFound':
        io.stderr('Пользователь не найден: сначала зарегистрируйтесь в приложении.\n');
        return 2;
      case 'unverified':
        io.stderr('E-mail пользователя не подтверждён: откройте ссылку из письма регистрации.\n');
        return 2;
    }
  } finally {
    await app.close();
  }
}

function parse(argv: string[]) {
  return parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
}
