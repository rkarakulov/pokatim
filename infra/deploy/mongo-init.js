// Идемпотентная подготовка MongoDB стека (deploy.sh → `compose exec -T mongo mongosh --quiet --nodb --eval <этот файл>`):
//   1. replica set rs0 из одного узла (член — адрес сервиса в сети compose, MONGO_RS_HOST) и ожидание PRIMARY;
//   2. root-пользователь admin (только администрирование, Q1) — на пустой БД через localhost exception;
//   3. пользователь приложения MONGO_APP_USER с readWrite только на свою БД MONGO_APP_DB (пароль — из .env,
//      при смене пароля в .env — обновляется).
// Пароли — только из env процесса mongosh (`exec -e ИМЯ` без значения): не в argv, не в выводе.
/* global Mongo, print, sleep -- глобальные mongosh */
const env = process.env;
const required = [
  'MONGO_ROOT_PASSWORD',
  'MONGO_PASSWORD',
  'MONGO_RS_HOST',
  'MONGO_APP_USER',
  'MONGO_APP_DB',
];
for (const name of required) {
  if (!env[name]) throw new Error(`mongo-init: нет ${name}`);
}
const port = env.MONGO_PORT || '27017';
const conn = new Mongo(`mongodb://127.0.0.1:${port}/?directConnection=true`);
const admin = conn.getDB('admin');

const say = (text) => print(`mongo-init: ${text}`);
const NOT_YET_INITIALIZED = 94;

function ensureReplicaSet() {
  try {
    admin.runCommand({ replSetGetStatus: 1 });
    return;
  } catch (error) {
    if (error.code !== NOT_YET_INITIALIZED) throw error;
  }
  admin.runCommand({
    replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: env.MONGO_RS_HOST }] },
  });
  say('replica set rs0 создан');
}

function waitPrimary() {
  for (let i = 0; i < 120; i += 1) {
    if (admin.runCommand({ hello: 1 }).isWritablePrimary) return;
    sleep(500);
  }
  throw new Error('узел не стал PRIMARY за 60 с');
}

// root уже есть — входим им; нет пользователей — localhost exception: набор и root создаются без входа
let authed = false;
try {
  authed = admin.auth('root', env.MONGO_ROOT_PASSWORD).ok === 1;
} catch {
  authed = false;
}
// Пользователи уже есть, а root из .env не входит: .env не совпадает с томом mongodata (потерян, перегенерирован).
// localhost exception закрыт — без пароля root набор и пользователей не изменить; значения не выводятся.
const UNAUTHORIZED = 13;
const MISMATCH =
  'MONGO_ROOT_PASSWORD из .env не подходит к root в томе mongodata — вернуть прежний .env или пересоздать том ' +
  '(данные dev теряются), docs/runbooks/deploy.md «.env сервера»';
// try/catch — прямо здесь: асинхронная перезапись mongosh не ждёт вызов функции, переданной параметром
if (!authed) {
  try {
    ensureReplicaSet();
    waitPrimary();
    admin.createUser({
      user: 'root',
      pwd: env.MONGO_ROOT_PASSWORD,
      roles: [{ role: 'root', db: 'admin' }],
    });
  } catch (error) {
    if (error.code === UNAUTHORIZED) throw new Error(MISMATCH);
    throw error;
  }
  if (admin.auth('root', env.MONGO_ROOT_PASSWORD).ok !== 1) throw new Error('вход root не удался');
  say('root-пользователь создан');
}
ensureReplicaSet();
waitPrimary();

const appDb = conn.getDB(env.MONGO_APP_DB);
const roles = [{ role: 'readWrite', db: env.MONGO_APP_DB }];
if (appDb.getUser(env.MONGO_APP_USER)) {
  appDb.updateUser(env.MONGO_APP_USER, { pwd: env.MONGO_PASSWORD, roles });
  say(`пользователь приложения ${env.MONGO_APP_USER} обновлён`);
} else {
  appDb.createUser({ user: env.MONGO_APP_USER, pwd: env.MONGO_PASSWORD, roles });
  say(`пользователь приложения ${env.MONGO_APP_USER} создан`);
}
say('готово');
