#!/usr/bin/env bash
# Репетиция обновления dev-стенда (CI job `deploy-rehearsal` в ci.yml или вручную на машине с Docker). На сервер не
# копируется. Только свой compose project (не pokatim-dev), временный HOME, без registry и nginx
# (POKATIM_SKIP_PULL/SKIP_NGINX). Образы — уже собранные локально `${POKATIM_IMAGE_PREFIX}-{api,web,admin}:${POKATIM_TAG}`.
#   (а) стек из BASE_REF: его deploy.sh, bootstrap.sh, docker-compose.yml, env.template, mongo-init.js (те же образы) +
#       маркер-данные в MongoDB; записи миграций, которых нет в BASE_REF, снимаются — БД в состоянии базовой ветки;
#   (б) новый deploy.sh поверх — новые миграции применены из runtime-образа, smoke, маркер на месте, пароли MongoDB и
#       секреты .env не изменились;
#   (в) повторный деплой идемпотентен — «новых миграций нет»;
#   (г) пользователь приложения pokatim пишет только в свою БД; образ api — с dist/db/migrate.js;
#   (д) деплой с битым JWT_SECRET падает, MongoDB и маркер на месте, .env (кроме JWT_SECRET) тот же; после
#       восстановления .env деплой проходит.
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
mkdir -p "${POKATIM_DIR}" "${WORK}/base"
chmod 700 "${POKATIM_DIR}"
ENV_FILE="${POKATIM_DIR}/.env"
VOLUME="${POKATIM_PROJECT}_mongodata"
SECRETS=(MONGO_ROOT_PASSWORD MONGO_PASSWORD JWT_SECRET EMAIL_TOKEN_SECRET MAILPIT_UI_PASSWORD)

step() { printf '\n::group::%s\n' "$*"; }
endstep() { printf '::endgroup::\n'; }
ok() { printf '[rehearsal] OK: %s\n' "$*"; }
fail() {
  printf '::error::rehearsal: %s\n' "$*"
  exit 1
}
line_hash() { grep "^$1=" "${ENV_FILE}" | sha256sum | cut -c1-16; }
secrets_hash() {
  local name
  for name in "${SECRETS[@]}"; do printf '%s:%s\n' "${name}" "$(line_hash "${name}")"; done
}
env_value() { awk -v key="$1" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); v = $0 } END { print v }' "${ENV_FILE}"; }
compose_dir() { docker compose -p "${POKATIM_PROJECT}" -f "${POKATIM_DIR}/docker-compose.yml" --env-file "${ENV_FILE}" "$@"; }
# mongosh под root (пароль — только в env процесса mongosh, не в argv); $1 — JS с `db` = БД pokatim
mongo_root() {
  # shellcheck disable=SC2016 # JS для mongosh: ${…} — шаблонные строки JS, не подстановка bash
  MONGO_ROOT_PASSWORD="$(env_value MONGO_ROOT_PASSWORD)" compose_dir exec -T -e MONGO_ROOT_PASSWORD mongo \
    mongosh --quiet --nodb --eval '
      const pw = encodeURIComponent(process.env.MONGO_ROOT_PASSWORD);
      const db = new Mongo(`mongodb://root:${pw}@127.0.0.1:27017/?directConnection=true&authSource=admin`)
        .getDB("pokatim");
    '"$1"
}
# id миграций ветки ref: файлы apps/api/src/db/migrations/NNNN_<имя>.ts
migration_ids() {
  git -C "${REPO}" ls-tree --name-only "$1" apps/api/src/db/migrations/ |
    sed -n 's#^apps/api/src/db/migrations/\([0-9]\{4\}_[a-z0-9_]*\)\.ts$#\1#p' | sort
}
marker_present() { mongo_root 'quit(db.rehearsal_marker.findOne({ _id: "marker" }) ? 0 : 5);'; }
cleanup() {
  local code=$?
  docker ps -aq --filter "label=com.docker.compose.project=${POKATIM_PROJECT}" | xargs -r docker rm -f >/dev/null
  docker volume ls -q --filter "label=com.docker.compose.project=${POKATIM_PROJECT}" |
    xargs -r docker volume rm >/dev/null || true
  rm -rf "${WORK}"
  exit "${code}"
}
trap cleanup EXIT

run_deploy() { bash "$1" >"${WORK}/deploy-$2.log" 2>&1; }
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

# ---------- (а) стек базовой ветки ----------
step "(а) стек ${BASE_REF}: его deploy.sh + маркер-данные в MongoDB"
for file in deploy.sh bootstrap.sh docker-compose.yml env.template mongo-init.js; do
  git -C "${REPO}" show "${BASE_REF}:infra/deploy/${file}" >"${WORK}/base/${file}"
done
# необязательные файлы базовой ветки (появились позже): берутся, если в ней есть
for file in docker-compose.ow.yml; do
  if git -C "${REPO}" cat-file -e "${BASE_REF}:infra/deploy/${file}" 2>/dev/null; then
    git -C "${REPO}" show "${BASE_REF}:infra/deploy/${file}" >"${WORK}/base/${file}"
  fi
done
# ядро раннера ≥ 6.19: mongod 8.0 базовой ветки не стартует без обхода rseq (SERVER-121912) — добавляем его в её
# compose, если там его ещё нет (после слияния обхода в базовую ветку шаг ничего не меняет)
if ! grep -q 'GLIBC_TUNABLES' "${WORK}/base/docker-compose.yml"; then
  awk '{ print } /^    image: mongo:8\.0/ { print "    environment:"; print "      GLIBC_TUNABLES: glibc.pthread.rseq=1" }' \
    "${WORK}/base/docker-compose.yml" >"${WORK}/base/docker-compose.rseq.yml"
  mv "${WORK}/base/docker-compose.rseq.yml" "${WORK}/base/docker-compose.yml"
  grep -q 'GLIBC_TUNABLES' "${WORK}/base/docker-compose.yml" || fail 'обход rseq не добавлен в compose базовой ветки'
fi
run_deploy "${WORK}/base/deploy.sh" base || {
  show_log base 80
  diagnose
  fail "деплой базовой ветки упал"
}
show_log base 15
mongo_root 'db.rehearsal_marker.insertOne({ _id: "marker", note: "до обновления" });' >/dev/null
marker_present || fail "маркер не записан"
# новые миграции ветки — снять их записи: БД как после деплоя базовой ветки (образы — этой ветки)
new_ids="$(comm -13 <(migration_ids "${BASE_REF}") <(migration_ids HEAD) | paste -sd, -)"
if [[ -n "${new_ids}" ]]; then
  mongo_root "db.getCollection('_migrations').deleteMany({ _id: { \$in: '${new_ids}'.split(',') } });" >/dev/null
fi
secrets_before="$(secrets_hash)"
jwt_before="$(line_hash JWT_SECRET)"
ok "стек базовой ветки поднят, маркер записан; новые миграции ветки: ${new_ids:-нет}"
endstep

# ---------- (б) обновление ----------
step "(б) новый deploy.sh поверх базового стека: миграции из образа, smoke, данные и секреты на месте"
run_deploy "${REPO}/infra/deploy/deploy.sh" first || {
  show_log first 80
  diagnose
  fail "деплой обновления упал"
}
show_log first 40
if [[ -n "${new_ids}" ]]; then
  grep -q "миграции применены: ${new_ids//,/, }" "${POKATIM_DIR}/migrate.log" ||
    fail "новые миграции не применены (ждём ${new_ids}): $(cat "${POKATIM_DIR}/migrate.log")"
else
  grep -q 'новых миграций нет' "${POKATIM_DIR}/migrate.log" || fail "migrate.log без итога"
fi
grep -q 'POKATIM_DEPLOYED=' "${WORK}/deploy-first.log" || fail "деплой не дошёл до конца"
marker_present || fail "маркер-данные потеряны при обновлении"
[[ "$(secrets_hash)" == "${secrets_before}" ]] || fail "пароли MongoDB или секреты .env изменились"
[[ "$(stat -c '%a' "${POKATIM_DIR}/mongo-keyfile")" == "600" ]] || fail "mongo-keyfile не 600"
health="$(curl -fsS "http://127.0.0.1:${POKATIM_API_PORT:-3100}/v1/health")"
[[ "${health}" == *'"database":"up"'* ]] || fail "health: ${health}"
docker volume inspect "${POKATIM_PROJECT}_trackfiles" >/dev/null 2>&1 || fail "нет тома trackfiles"
[[ "$(env_value DEVICES_ENABLED)" == "false" ]] || fail "устройства включены по умолчанию"
[[ -z "$(env_value OW_API_KEY)" ]] || fail "в шаблоне .env оказался ключ OW"
devices="$(curl -sS "http://127.0.0.1:${POKATIM_API_PORT:-3100}/v1/devices" -o /dev/null -w '%{http_code}' || true)"
[[ "${devices}" == "401" ]] || fail "GET /v1/devices без входа: ${devices} (ждём 401)"
compose_dir exec -T api sh -c 'test -w /data/trackfiles' || fail "том trackfiles не доступен api на запись"
ok "обновление: миграции ${new_ids:-—} применены, smoke зелёный, данные и секреты на месте"
ok "треки и устройства: том trackfiles, DEVICES_ENABLED=false, ключей OW нет — стенд стартует без них"
endstep

# ---------- (в) повторный деплой ----------
step "(в) повторный deploy.sh: идемпотентен, миграций нет"
run_deploy "${REPO}/infra/deploy/deploy.sh" second || {
  show_log second 80
  diagnose
  fail "повторный деплой упал"
}
show_log second 25
grep -q 'новых миграций нет' "${POKATIM_DIR}/migrate.log" || fail "повторный деплой применил миграции"
grep -q 'пользователь приложения pokatim обновлён' "${WORK}/deploy-second.log" || fail "mongo-init не идемпотентен"
marker_present || fail "маркер-данные потеряны повторным деплоем"
[[ "$(secrets_hash)" == "${secrets_before}" ]] || fail "повторный деплой изменил секреты"
ok "повторный деплой идемпотентен"
endstep

# ---------- (г) права пользователя приложения и образ ----------
step "(г) пользователь pokatim — readWrite только на БД pokatim; без входа — отказ"
# shellcheck disable=SC2016 # JS для mongosh: ${…} — шаблонные строки JS, не подстановка bash
MONGO_PASSWORD="$(env_value MONGO_PASSWORD)" compose_dir exec -T -e MONGO_PASSWORD mongo mongosh --quiet --nodb --eval '
    const url = (auth) => `mongodb://${auth}127.0.0.1:27017/?directConnection=true&authSource=pokatim`;
    const app = new Mongo(url(`pokatim:${encodeURIComponent(process.env.MONGO_PASSWORD)}@`));
    app.getDB("pokatim").rehearsal.insertOne({ ok: 1 });
    const denied = (fn) => { try { fn(); return false; } catch (e) { return e.codeName === "Unauthorized"; } };
    if (!denied(() => app.getDB("admin").rehearsal.insertOne({ ok: 1 }))) quit(2);
    if (!denied(() => app.getDB("other").rehearsal.insertOne({ ok: 1 }))) quit(3);
    if (!denied(() => new Mongo(url("")).getDB("pokatim").rehearsal.findOne())) quit(4);
    print("права pokatim: ok");
  '
docker run --rm --entrypoint sh "${POKATIM_IMAGE_PREFIX}-api:${POKATIM_TAG}" \
  -c 'test -f /app/apps/api/dist/db/migrate.js' || fail "образ api: нет dist/db/migrate.js"
ok "права пользователя и образ api"
endstep
# ---------- (д) негатив: деплой падает — данные MongoDB на месте ----------
step "(д) deploy.sh с битым JWT_SECRET: деплой падает, MongoDB и маркер остаются; после восстановления — проходит"
jwt_line="$(grep '^JWT_SECRET=' "${ENV_FILE}")"
sed -i 's/^JWT_SECRET=.*/JWT_SECRET=short/' "${ENV_FILE}"
if run_deploy "${REPO}/infra/deploy/deploy.sh" broken; then
  show_log broken
  fail "деплой с битым JWT_SECRET прошёл"
fi
show_log broken 15
docker volume inspect "${VOLUME}" >/dev/null 2>&1 || fail "том ${VOLUME} удалён упавшим деплоем"
marker_present || fail "маркер-данные потеряны упавшим деплоем"
JWT_LINE="${jwt_line}" awk 'index($0, "JWT_SECRET=") == 1 { print ENVIRON["JWT_LINE"]; next } { print }' \
  "${ENV_FILE}" >"${WORK}/env.fixed"
cat "${WORK}/env.fixed" >"${ENV_FILE}"
rm -f "${WORK}/env.fixed"
[[ "$(line_hash JWT_SECRET)" == "${jwt_before}" ]] || fail "JWT_SECRET не восстановлен"
[[ "$(secrets_hash)" == "${secrets_before}" ]] || fail "упавший деплой изменил секреты .env"
run_deploy "${REPO}/infra/deploy/deploy.sh" restored || {
  show_log restored 80
  diagnose
  fail "деплой после восстановления JWT_SECRET упал"
}
marker_present || fail "маркер-данные потеряны после восстановления"
[[ "$(secrets_hash)" == "${secrets_before}" ]] || fail "секреты изменились после восстановления"
ok "упавший деплой не тронул MongoDB и секреты; после восстановления .env деплой проходит"
endstep


echo "REHEARSAL=ok"
