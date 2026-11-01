import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { NestFactory } from '@nestjs/core';
import { DisplayName, Email } from '@pokatim/contracts';

import type { CliEnv } from '../config/env';
import { PanelMembersService } from '../modules/panel';
import { ReservedRiderLines } from '../modules/profile';
import { PanelCliModule } from './panel-cli.module';

export const CLI_USAGE = `Панель «Протокол» — команды сервера.

  grant-admin --email <e-mail> --name <имя в панели>
      Роль «администратор» существующему пользователю приложения с подтверждённым e-mail
      (первый и аварийный администратор). Запись журнала — с актором cli.

  reset-totp --email <e-mail>
      Аварийный сброс 2FA сотрудника (потерян телефон и коды восстановления): 2FA, доверенные устройства
      и сессии панели удаляются. Запись журнала — с актором cli.

  reserved-names
      Профили, где имя или клуб совпадает со служебной подписью таблицы («Райдер #N», «Участник», «Вы»;
      сохранены до запрета, name-consent-prompt N8): id пользователя, поля и карточка в панели («скрыт» —
      профиль не публичен, карточка поле не показывает). Только чтение — сброс модератором (runbook deploy.md).

Коды выхода: 0 — готово (уже администратор; 2FA не подключена), 2 — неверные аргументы или пользователь не подходит, 1 — сбой.
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
  if (
    !['grant-admin', 'reset-totp', 'reserved-names'].includes(command) ||
    parsed.positionals.length > 1
  ) {
    io.stderr(`Неизвестная команда.\n\n${CLI_USAGE}`);
    return 2;
  }
  if (command === 'reserved-names') {
    if (parsed.values.email !== undefined || parsed.values.name !== undefined) {
      io.stderr('У reserved-names нет аргументов.\n');
      return 2;
    }
    return withContext(env, ReservedRiderLines, (lines) => reservedNames(lines, io));
  }
  const email = Email.safeParse(parsed.values.email);
  if (command === 'reset-totp') {
    if (!email.success || parsed.values.name !== undefined) {
      io.stderr('Нужен --email (адрес).\n');
      return 2;
    }
    return withMembers(env, (members) => resetTotp(members, email.data, io));
  }
  const name = DisplayName.safeParse(parsed.values.name);
  if (!email.success || !name.success) {
    io.stderr('Нужны --email (адрес) и --name (имя в панели, 1–80 символов).\n');
    return 2;
  }
  return withMembers(env, (members) => grantAdmin(members, email.data, name.data, io));
}

/** Контекст без HTTP на время одной команды. */
async function withContext<T>(
  env: () => CliEnv,
  service: new (...args: never[]) => T,
  run: (instance: T) => Promise<number>,
): Promise<number> {
  const app = await NestFactory.createApplicationContext(PanelCliModule.forRoot(env()), {
    logger: ['error'],
  });
  try {
    return await run(app.get(service));
  } finally {
    await app.close();
  }
}

const withMembers = (env: () => CliEnv, run: (members: PanelMembersService) => Promise<number>) =>
  withContext(env, PanelMembersService, run);

const FIELD_LABEL = { name: 'имя', club: 'клуб' } as const;

async function reservedNames(lines: ReservedRiderLines, io: CliIo): Promise<number> {
  const found = await lines.find();
  for (const { userId, fields, visible } of found) {
    const labels = fields.map((field) => FIELD_LABEL[field]).join(', ');
    io.stdout(`${userId}\t${labels}\t${visible ? `/admin/rider-profiles/${userId}` : 'скрыт'}\n`);
  }
  io.stdout(
    found.length === 0
      ? 'Служебных подписей в профилях нет.\n'
      : `Профилей со служебной подписью: ${found.length}. Сбросьте поле в карточке профиля в панели.\n`,
  );
  return 0;
}

async function grantAdmin(
  members: PanelMembersService,
  email: string,
  name: string,
  io: CliIo,
): Promise<number> {
  const result = await members.grantAdminFromCli(email, name);
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
}

async function resetTotp(members: PanelMembersService, email: string, io: CliIo): Promise<number> {
  const result = await members.resetTotpFromCli(email);
  switch (result.state) {
    case 'reset':
      io.stdout(`2FA сброшена, сессии панели отозваны. Пользователь: ${result.userId}\n`);
      return 0;
    case 'notEnabled':
      io.stdout(`2FA не подключена: ${result.userId}\n`);
      return 0;
    case 'notFound':
      io.stderr('Пользователь не найден.\n');
      return 2;
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
