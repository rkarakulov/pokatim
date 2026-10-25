#!/usr/bin/env bash
# Репетиция переезда dev-стенда PostgreSQL → MongoDB (task.md pokatim-mongo, AC7/AC8) — CI job `deploy-rehearsal`
# (ci.yml) или вручную на машине с Docker. На сервер не копируется. Только свой compose project (не pokatim-dev),
# временный HOME, без registry и nginx (POKATIM_SKIP_PULL/SKIP_NGINX). Образы — уже собранные локально
# `${POKATIM_IMAGE_PREFIX}-{api,web,admin}:${POKATIM_TAG}`.
#   (а) старый стек из BASE_REF (postgres, redis, mailpit; .env — его bootstrap) + маркер-данные в PostgreSQL;
#   (д) новый deploy.sh с битым JWT_SECRET — деплой падает, контейнер и том postgres на месте;
#   (б) новый deploy.sh — mongo (auth + keyfile), mongo-init.js, миграции из runtime-образа, smoke, retire_postgres:
#       удалён только свой том, секреты .env сохранены, ключи PostgreSQL убраны;
#   (в) повторный деплой — без шагов переезда, «новых миграций нет»;
#   (г) пользователь приложения pokatim пишет только в свою БД.
# Env: BASE_REF (origin/develop), POKATIM_PROJECT (pokatim-rehearsal), POKATIM_TAG, POKATIM_IMAGE_PREFIX.
# Значения секретов не выводятся: сравниваются хеши строк .env.
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE_REF="${BASE_REF:-origin/develop}"
export POKATIM_PROJECT="${POKATIM_PROJECT:-pokatim-rehearsal}"
export POKATIM_TAG="${POKATIM_TAG:?нужен тег локальных образов}"
export POKATIM_IMAGE_PREFIX="${POKATIM_IMAGE_PREFIX:?нужен префикс локальных образов}"
export PUBLIC_HOST="${PUBLIC_HOST:-rehearsal.pokatim.test}"
export POKATIM_SKIP_PULL=1 POKATIM_SKIP_NGINX=1
[[ "${POKATIM_PROJECT}" != "pokatim-dev" ]] || {
  echo "::error::репетиция — только в своём POKATIM_PROJECT, не pokatim-dev" >&2
  exit 1
}

WORK="$(mktemp -d)"
export HOME="${WORK}/home"
export POKATIM_DIR="${HOME}/pokatim"
mkdir -p "${POKATIM_DIR}" "${WORK}/old"
chmod 700 "${POKATIM_DIR}"
ENV_FILE="${POKATIM_DIR}/.env"
VOLUME="${POKATIM_PROJECT}_pgdata"

step() { printf '\n::group::%s\n' "$*"; }
endstep() { printf '::endgroup::\n'; }
ok() { printf '[rehearsal] OK: %s\n' "$*"; }
fail() {
  printf '::error::rehearsal: %s\n' "$*"
  exit 1
}
line_hash() { grep "^$1=" "${ENV_FILE}" | sha256sum | cut -c1-16; }
compose_dir() { docker compose -p "${POKATIM_PROJECT}" -f "${POKATIM_DIR}/docker-compose.yml" --env-file "${ENV_FILE}" "$@"; }
postgres_ids() {
  docker ps -aq --filter "label=com.docker.compose.project=${POKATIM_PROJECT}" \
    --filter 'label=com.docker.compose.service=postgres'
}
cleanup() {
  local code=$?
  docker ps -aq --filter "label=com.docker.compose.project=${POKATIM_PROJECT}" | xargs -r docker rm -f >/dev/null
  docker volume ls -q --filter "label=com.docker.compose.project=${POKATIM_PROJECT}" |
    xargs -r docker volume rm >/dev/null || true
  rm -rf "${WORK}"
  exit "${code}"
}
trap cleanup EXIT

# ---------- (а) старый стек из BASE_REF ----------
step "(а) старый стек ${BASE_REF}: postgres, redis, mailpit + маркер-данные"
for file in docker-compose.yml bootstrap.sh env.template; do
  git -C "${REPO}" show "${BASE_REF}:infra/deploy/${file}" >"${WORK}/old/${file}"
done
cp "${WORK}/old/docker-compose.yml" "${WORK}/old/env.template" "${WORK}/old/bootstrap.sh" "${POKATIM_DIR}/"
bash "${POKATIM_DIR}/bootstrap.sh" >/dev/null
grep -q '^POSTGRES_PASSWORD=' "${ENV_FILE}" || fail "старый bootstrap не создал POSTGRES_PASSWORD"
compose_dir up -d --wait --wait-timeout 180 postgres redis mailpit
compose_dir exec -T postgres psql -q -U pokatim -d pokatim \
  -c 'CREATE TABLE rehearsal_marker (note text)' -c "INSERT INTO rehearsal_marker VALUES ('до переезда')"
jwt_before="$(line_hash JWT_SECRET)"
mail_before="$(line_hash MAILPIT_UI_PASSWORD)"
ok "старый стек поднят, маркер записан, том ${VOLUME}"
endstep

run_deploy() { bash "${REPO}/infra/deploy/deploy.sh" >"${WORK}/deploy-$1.log" 2>&1; }
# диагностика упавшего шага: стенд CI, персональных данных нет; mongo-init.log — без паролей (они только в env mongosh)
diagnose() {
  echo "--- mongo-init.log"
  cat "${POKATIM_DIR}/mongo-init.log" 2>/dev/null || true
  echo "--- migrate.log"
  cat "${POKATIM_DIR}/migrate.log" 2>/dev/null || true
  echo "--- logs mongo, api"
  compose_dir logs --no-color --tail 60 mongo api 2>/dev/null || true
}
show_log() { grep -vE '^\s*$' "${WORK}/deploy-$1.log" | tail -n "${2:-40}"; }

# ---------- (д) негатив: деплой падает — PostgreSQL на месте ----------
step "(д) новый deploy.sh с битым JWT_SECRET: деплой падает, postgres и том остаются"
# портится только JWT_SECRET: остальное (в т. ч. пароли MongoDB, которые допишет bootstrap) переживает сбой, как на
# сервере — следующий деплой идёт с тем же .env и тем же томом mongodata
jwt_line="$(grep '^JWT_SECRET=' "${ENV_FILE}")"
sed -i 's/^JWT_SECRET=.*/JWT_SECRET=short/' "${ENV_FILE}"
if run_deploy broken; then
  show_log broken
  fail "деплой с битым JWT_SECRET прошёл"
fi
show_log broken 15
[[ -n "$(postgres_ids)" ]] || fail "контейнер postgres удалён упавшим деплоем"
docker volume inspect "${VOLUME}" >/dev/null 2>&1 || fail "том ${VOLUME} удалён упавшим деплоем"
grep -q '^POSTGRES_PASSWORD=' "${ENV_FILE}" || fail "ключи PostgreSQL убраны из .env упавшим деплоем"
grep -q '^MONGO_ROOT_PASSWORD=' "${ENV_FILE}" || fail "упавший деплой не сохранил MONGO_ROOT_PASSWORD в .env"
JWT_LINE="${jwt_line}" awk 'index($0, "JWT_SECRET=") == 1 { print ENVIRON["JWT_LINE"]; next } { print }' \
  "${ENV_FILE}" >"${WORK}/env.fixed"
cat "${WORK}/env.fixed" >"${ENV_FILE}"
rm -f "${WORK}/env.fixed"
[[ "$(line_hash JWT_SECRET)" == "${jwt_before}" ]] || fail "JWT_SECRET не восстановлен"
ok "упавший деплой не тронул PostgreSQL; повтор — с тем же .env (mongo уже инициализирован)"
endstep

# ---------- (б) переезд ----------
step "(б) новый deploy.sh: mongo, миграции из образа, smoke, retire_postgres"
run_deploy first || {
  show_log first 80
  diagnose
  fail "первый деплой упал"
}
show_log first 60
grep -q 'mongo-init: готово' "${WORK}/deploy-first.log" || fail "нет mongo-init: готово"
grep -q "переезд на MongoDB: том ${VOLUME} удалён" "${WORK}/deploy-first.log" || fail "том ${VOLUME} не удалён"
grep -qE 'миграции применены|новых миграций нет' "${POKATIM_DIR}/migrate.log" || fail "migrate.log без итога"
[[ -z "$(postgres_ids)" ]] || fail "контейнер postgres остался"
! docker volume inspect "${VOLUME}" >/dev/null 2>&1 || fail "том ${VOLUME} остался"
docker volume inspect "${POKATIM_PROJECT}_mongodata" >/dev/null || fail "нет тома mongodata"
! grep -qE '^(POSTGRES_[A-Z0-9_]*|DATABASE_URL)=' "${ENV_FILE}" || fail "ключи PostgreSQL остались в .env"
[[ "$(line_hash JWT_SECRET)" == "${jwt_before}" ]] || fail "JWT_SECRET изменился"
[[ "$(line_hash MAILPIT_UI_PASSWORD)" == "${mail_before}" ]] || fail "MAILPIT_UI_PASSWORD изменился"
grep -q '^MONGO_ROOT_PASSWORD=' "${ENV_FILE}" || fail "нет MONGO_ROOT_PASSWORD"
grep -q '^MONGO_PASSWORD=' "${ENV_FILE}" || fail "нет MONGO_PASSWORD"
[[ "$(stat -c '%a' "${POKATIM_DIR}/mongo-keyfile")" == "600" ]] || fail "mongo-keyfile не 600"
health="$(curl -fsS "http://127.0.0.1:${POKATIM_API_PORT:-3100}/v1/health")"
[[ "${health}" == *'"database":"up"'* ]] || fail "health: ${health}"
ok "переезд: PostgreSQL снят (только свой том), MongoDB up, секреты сохранены"
endstep

# ---------- (в) повторный деплой ----------
step "(в) повторный deploy.sh: без шагов переезда, миграций нет"
run_deploy second || {
  show_log second 80
  diagnose
  fail "повторный деплой упал"
}
show_log second 25
! grep -q 'переезд на MongoDB' "${WORK}/deploy-second.log" || fail "повторный деплой выполнил шаги переезда"
grep -q 'новых миграций нет' "${POKATIM_DIR}/migrate.log" || fail "повторный деплой применил миграции"
grep -q 'пользователь приложения pokatim обновлён' "${WORK}/deploy-second.log" || fail "mongo-init не идемпотентен"
ok "повторный деплой идемпотентен"
endstep

# ---------- (г) права пользователя приложения и образ ----------
step "(г) пользователь pokatim — readWrite только на БД pokatim; без входа — отказ"
# shellcheck disable=SC2016 # JS для mongosh: ${…} — шаблонные строки JS, не подстановка bash
MONGO_PASSWORD="$(awk 'index($0, "MONGO_PASSWORD=") == 1 { sub(/^[^=]*=/, ""); v = $0 } END { print v }' "${ENV_FILE}")" \
  compose_dir exec -T -e MONGO_PASSWORD mongo mongosh --quiet --nodb --eval '
    const url = (auth) => `mongodb://${auth}127.0.0.1:27017/?directConnection=true&authSource=pokatim`;
    const app = new Mongo(url(`pokatim:${process.env.MONGO_PASSWORD}@`));
    app.getDB("pokatim").rehearsal.insertOne({ ok: 1 });
    const denied = (fn) => { try { fn(); return false; } catch (e) { return e.codeName === "Unauthorized"; } };
    if (!denied(() => app.getDB("admin").rehearsal.insertOne({ ok: 1 }))) quit(2);
    if (!denied(() => app.getDB("other").rehearsal.insertOne({ ok: 1 }))) quit(3);
    if (!denied(() => new Mongo(url("")).getDB("pokatim").rehearsal.findOne())) quit(4);
    print("права pokatim: ok");
  '
docker run --rm --entrypoint sh "${POKATIM_IMAGE_PREFIX}-api:${POKATIM_TAG}" \
  -c 'test ! -e /app/node_modules/drizzle-kit && test -f /app/apps/api/dist/db/migrate.js' ||
  fail "образ api: drizzle-kit есть или нет dist/db/migrate.js"
ok "права пользователя и образ api"
endstep
echo "REHEARSAL=ok"
