#!/usr/bin/env bash
# Идемпотентная подготовка dev-сервера под pokatim (вызывается deploy.sh на каждом деплое):
#   1. каталог стека ${POKATIM_DIR} (700);
#   2. .env (600): недостающие ключи из env.template дописываются, @secret генерируется здесь же
#      (openssl rand) — значения не печатаются и не покидают сервер; существующие значения не меняются,
#      кроме управляемых деплоем PUBLIC_HOST, WEB_ORIGIN, APP_LINK_BASE, POKATIM_TAG, MAIL_RELAY_RECIPIENTS и
#      MAILPIT_RELAY_*;
#   2b. keyfile replica set MongoDB ${POKATIM_DIR}/mongo-keyfile (600): генерируется здесь же один раз (openssl rand),
#      не печатается и не покидает сервер (Q1);
#   2a. relay Mailpit → внешний SMTP (Amazon SES, Gmail): ${POKATIM_DIR}/mailpit-relay.yml (600) из MAIL_RELAY_*
#      .env; получатели MAIL_RELAY_RECIPIENTS — точные адреса (регулярку для Mailpit собирает этот скрипт) или «*»
#      (relay всех писем); без логина, пароля или получателей — relay выключен (письма только в Mailpit);
#   3. vhost nginx хоста /etc/nginx/sites-available/pokatim (+ ссылка в sites-enabled): nginx -t перед reload,
#      ошибка — откат своего файла; чужие сайты не трогаются;
#   4. сертификат Let's Encrypt (certbot --webroot /var/www/html) — только если домен ведёт на этот сервер;
#      иначе (или certbot не смог) vhost только на :80 и предупреждение, деплой не падает.
#      UI Mailpit /mail/ — только в https-vhost (пароль basic-auth не идёт открытым текстом).
# Env: PUBLIC_HOST (обязательно), POKATIM_TAG, POKATIM_DIR (~/pokatim), CERTBOT_EMAIL (необязательно),
#      MAIL_RELAY_RECIPIENTS_STDIN=1 — получатели relay (адреса через запятую или «*») первой строкой stdin: в .env,
#      пустая строка выключает relay; без флага — прежние из .env,
#      POKATIM_{API,WEB,ADMIN,MAIL_UI}_PORT, POKATIM_SKIP_NGINX=1 — без шагов 3–4 (локальная проверка).
# Пишет строки `POKATIM_TLS=https|http` и `POKATIM_MAIL_RELAY=list|all|off` для сводки деплоя; `::warning::` — аннотации
# GitHub Actions.
set -euo pipefail
umask 077

POKATIM_DIR="${POKATIM_DIR:-${HOME}/pokatim}"
ENV_FILE="${POKATIM_DIR}/.env"
TEMPLATE="${POKATIM_DIR}/env.template"
API_PORT="${POKATIM_API_PORT:-3100}"
WEB_PORT="${POKATIM_WEB_PORT:-8180}"
ADMIN_PORT="${POKATIM_ADMIN_PORT:-8181}"
MAIL_PORT="${POKATIM_MAIL_UI_PORT:-8125}"
SITE_NAME="pokatim"
SITE_FILE="/etc/nginx/sites-available/${SITE_NAME}"
SITE_LINK="/etc/nginx/sites-enabled/${SITE_NAME}"
WEBROOT="/var/www/html"
RELAY_FILE="${POKATIM_DIR}/mailpit-relay.yml"
KEYFILE="${POKATIM_DIR}/mongo-keyfile"
MANAGED_KEYS="PUBLIC_HOST WEB_ORIGIN APP_LINK_BASE POKATIM_TAG MAIL_RELAY_RECIPIENTS"
MANAGED_KEYS="${MANAGED_KEYS} MAILPIT_RELAY_CONFIG MAILPIT_RELAY_ALL MAILPIT_RELAY_MATCHING MAILPIT_RELAY_REV"

log() { printf '[bootstrap] %s\n' "$*"; }
warn() { printf '::warning::%s\n' "$*"; }
die() {
  printf '::error::%s\n' "$*"
  exit 1
}

PUBLIC_HOST="${PUBLIC_HOST:-}"
[[ "${PUBLIC_HOST}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
  die "PUBLIC_HOST не задан или не похож на имя хоста: '${PUBLIC_HOST}'"
POKATIM_TAG="${POKATIM_TAG:-}"
[[ -z "${POKATIM_TAG}" || "${POKATIM_TAG}" =~ ^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$ ]] ||
  die "POKATIM_TAG не похож на тег образа: '${POKATIM_TAG}'"
for port in "${API_PORT}" "${WEB_PORT}" "${ADMIN_PORT}" "${MAIL_PORT}"; do
  [[ "${port}" =~ ^[0-9]{2,5}$ ]] || die "порт не число: '${port}'"
done

# Получатели relay (секрет DEV_MAIL_RELAY_RECIPIENTS): ровно «*» — relay всех писем, иначе точные адреса через
# запятую: не больше 20, каждый — простой e-mail из безопасного набора символов (пробелы по краям и пустые элементы
# отбрасываются). Та же проверка — preflight deploy-dev.yml. parse_recipients задаёт RELAY_RECIPIENTS («*» или
# нормализованный список) или падает с номером элемента — без значений (адреса тестировщиков не попадают в лог).
RELAY_EMAIL_RE='^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$'
RELAY_MAX_RECIPIENTS=20
parse_recipients() {
  local raw="$1" item n=0 items=()
  RELAY_RECIPIENTS=""
  [[ ! "${raw}" =~ [[:cntrl:]] ]] || die "получатели relay: управляющие символы (перевод строки?)"
  item="${raw#"${raw%%[![:space:]]*}"}"
  if [[ "${item%"${item##*[![:space:]]}"}" == "*" ]]; then
    RELAY_RECIPIENTS="*"
    return 0
  fi
  IFS=, read -r -a items <<<"${raw}"
  for item in "${items[@]+"${items[@]}"}"; do
    item="${item#"${item%%[![:space:]]*}"}"
    item="${item%"${item##*[![:space:]]}"}"
    [[ -n "${item}" ]] || continue
    n=$((n + 1))
    [[ ${#item} -le 254 && "${item}" =~ ${RELAY_EMAIL_RE} ]] ||
      die "получатели relay: элемент ${n} — не простой e-mail (латиница, цифры, . _ + -; без пробелов и кавычек)"
    RELAY_RECIPIENTS="${RELAY_RECIPIENTS:+${RELAY_RECIPIENTS},}${item}"
  done
  [[ ${n} -le ${RELAY_MAX_RECIPIENTS} ]] || die "получатели relay: ${n} адресов, допустимо не больше ${RELAY_MAX_RECIPIENTS}"
}

# Якорная регулярка RE2 для Mailpit из точных адресов: (?i)^(a@x\.com|b@y\.org)$ — «.» и «+» экранируются (другие
# спецсимволы RE2 parse_recipients не пропускает), регистр не важен (домен e-mail регистронезависим).
recipients_regex() {
  local list="$1" out="" c i
  for ((i = 0; i < ${#list}; i++)); do
    c="${list:i:1}"
    case "${c}" in
      [.+]) out="${out}\\${c}" ;;
      ,) out="${out}|" ;;
      *) out="${out}${c}" ;;
    esac
  done
  printf '(?i)^(%s)$' "${out}"
}

if [[ "${MAIL_RELAY_RECIPIENTS_STDIN:-0}" == "1" ]]; then
  relay_input=""
  IFS= read -r relay_input || true
  parse_recipients "${relay_input}"
  unset relay_input
  RELAY_RECIPIENTS_GIVEN=1
else
  RELAY_RECIPIENTS_GIVEN=0
fi

# ---------- 1–2. каталог и .env ----------

# значение ключа из .env (без вывода); пусто — ключа нет
env_get() {
  [[ -f "${ENV_FILE}" ]] || return 0
  awk -v key="$1" 'index($0, key "=") == 1 { sub(/^[^=]*=/, ""); value = $0 } END { if (value != "") print value }' \
    "${ENV_FILE}"
}

# то же без одной пары внешних кавычек ('…' или "…"), как их снимает docker compose
env_value() {
  local value
  value="$(env_get "$1")"
  if [[ ${#value} -ge 2 && "${value:0:1}" == "${value: -1}" && ( "${value:0:1}" == "'" || "${value:0:1}" == '"' ) ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "${value}"
}

env_has() {
  [[ -f "${ENV_FILE}" ]] && grep -q "^$1=" "${ENV_FILE}"
}

ensure_env() {
  mkdir -p "${POKATIM_DIR}"
  chmod 700 "${POKATIM_DIR}"
  [[ -f "${TEMPLATE}" ]] || die "нет ${TEMPLATE} (деплой копирует его рядом со скриптом)"
  [[ -f "${ENV_FILE}" ]] || {
    : >"${ENV_FILE}"
    log ".env создан"
  }
  chmod 600 "${ENV_FILE}"

  local line key value added=""
  while IFS= read -r line || [[ -n "${line}" ]]; do
    [[ "${line}" =~ ^[A-Z][A-Z0-9_]*= ]] || continue
    key="${line%%=*}"
    value="${line#*=}"
    env_has "${key}" && continue
    if [[ "${value}" == "@secret" ]]; then
      value="$(openssl rand -hex 32)"
    fi
    printf '%s=%s\n' "${key}" "${value}" >>"${ENV_FILE}"
    added="${added} ${key}"
  done <"${TEMPLATE}"
  [[ -z "${added}" ]] || log "в .env добавлены ключи:${added}"

  # управляемые деплоем ключи — всегда из параметров (смена домена, новый тег, регулярка relay)
  PREVIOUS_HOST="$(env_get PUBLIC_HOST)"
  local tag="${POKATIM_TAG:-$(env_get POKATIM_TAG)}"
  configure_mail_relay
  local tmp
  tmp="$(mktemp "${POKATIM_DIR}/.env.XXXXXX")"
  awk -v keys="${MANAGED_KEYS}" '
    BEGIN { n = split(keys, list, " "); for (i = 1; i <= n; i++) managed[list[i]] = 1 }
    { key = $0; sub(/=.*/, "", key); if (!(key in managed)) print }
  ' "${ENV_FILE}" >"${tmp}"
  {
    printf 'PUBLIC_HOST=%s\n' "${PUBLIC_HOST}"
    printf 'WEB_ORIGIN=https://%s\n' "${PUBLIC_HOST}"
    printf 'APP_LINK_BASE=https://%s/\n' "${PUBLIC_HOST}"
    [[ -z "${tag}" ]] || printf 'POKATIM_TAG=%s\n' "${tag}"
    # одинарные кавычки — без подстановки ${…} в compose (в регулярке бывает «$»)
    printf "MAIL_RELAY_RECIPIENTS='%s'\n" "${RELAY_RECIPIENTS}"
    printf "MAILPIT_RELAY_MATCHING='%s'\n" "${RELAY_ACTIVE_MATCHING}"
    # конфиг relay — только при включённом relay: matching/all без конфига Mailpit не принимает
    if [[ "${RELAY_MODE}" == "off" ]]; then
      printf 'MAILPIT_RELAY_CONFIG=\nMAILPIT_RELAY_ALL=false\n'
    else
      printf 'MAILPIT_RELAY_CONFIG=/etc/mailpit/relay.yml\nMAILPIT_RELAY_ALL=%s\n' \
        "$([[ "${RELAY_MODE}" == "all" ]] && echo true || echo false)"
    fi
    printf 'MAILPIT_RELAY_REV=%s\n' "${RELAY_REV}"
  } >>"${tmp}"
  chmod 600 "${tmp}"
  mv -f "${tmp}" "${ENV_FILE}"
  log ".env: PUBLIC_HOST=${PUBLIC_HOST}${tag:+, POKATIM_TAG=${tag}} (секреты не выводятся)"
}

# ---------- 2b. keyfile replica set MongoDB ----------

# Общий секрет членов набора (Q1): с ним mongod требует входа (пользователи — deploy.sh, mongo-init.js). Base64 756
# байт (mongod: 6–1024 символа base64); существующий не меняется — смена требует перезапуска mongo.
ensure_mongo_keyfile() {
  if [[ -s "${KEYFILE}" ]]; then
    chmod 600 "${KEYFILE}"
    return 0
  fi
  local tmp
  tmp="$(mktemp "${POKATIM_DIR}/.keyfile.XXXXXX")"
  openssl rand -base64 756 >"${tmp}"
  chmod 600 "${tmp}"
  mv -f "${tmp}" "${KEYFILE}"
  log "MongoDB: keyfile replica set создан (значение не выводится)"
}

# ---------- 2a. relay Mailpit → внешний SMTP (Amazon SES, Gmail) ----------

# строка YAML в одинарных кавычках ('' внутри)
yaml_quote() {
  local q="'"
  printf "'%s'" "${1//${q}/${q}${q}}"
}

# Пишет ${RELAY_FILE} (всегда: compose монтирует файл) и задаёт RELAY_RECIPIENTS (для .env), RELAY_MODE
# (off|list|all), RELAY_ACTIVE_MATCHING (регулярка в режиме list, иначе пусто) и RELAY_REV (хеш файла: смена
# логина/пароля/получателей пересоздаёт mailpit).
# Логин и пароль — только в переменных этого процесса и в файле 600: не в argv, не в лог, не в env контейнера.
# Набор символов логина и пароля ограничен: значение безопасно в .env (с кавычками и без) и в YAML.
RELAY_CRED_RE='^[A-Za-z0-9._@+/=-]+$'
configure_mail_relay() {
  # без флага stdin — прежний список из .env (ручной запуск deploy.sh)
  [[ "${RELAY_RECIPIENTS_GIVEN}" == "1" ]] || parse_recipients "$(env_value MAIL_RELAY_RECIPIENTS)"
  RELAY_ACTIVE_MATCHING=""
  RELAY_MODE=off
  local host port username password missing="" tmp matching=""
  host="$(env_value MAIL_RELAY_HOST)"
  port="$(env_value MAIL_RELAY_PORT)"
  username="$(env_value MAIL_RELAY_USERNAME)"
  password="$(env_value MAIL_RELAY_PASSWORD)"
  [[ -n "${RELAY_RECIPIENTS}" ]] || missing="${missing} MAIL_RELAY_RECIPIENTS"
  [[ -n "${username}" ]] || missing="${missing} MAIL_RELAY_USERNAME"
  [[ -n "${password}" ]] || missing="${missing} MAIL_RELAY_PASSWORD"

  tmp="$(mktemp "${POKATIM_DIR}/.relay.XXXXXX")"
  if [[ -n "${missing}" ]]; then
    printf '# relay выключен: генерирует bootstrap.sh (нет%s в .env)\n' "${missing}" >"${tmp}"
    log "почта: relay выключен (нет${missing}) — письма только в Mailpit"
  else
    [[ "${host}" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$ ]] ||
      die "MAIL_RELAY_HOST в .env не похож на имя хоста"
    [[ "${port}" =~ ^[1-9][0-9]{0,4}$ && "${port}" -le 65535 ]] || die "MAIL_RELAY_PORT в .env не порт"
    [[ "${username}" =~ ${RELAY_CRED_RE} ]] ||
      die "MAIL_RELAY_USERNAME в .env: допустимы латиница, цифры и . _ @ + / = - (без пробелов и кавычек внутри)"
    [[ "${password}" =~ ${RELAY_CRED_RE} ]] ||
      die "MAIL_RELAY_PASSWORD в .env: допустимы латиница, цифры и . _ @ + / = - (без пробелов и кавычек внутри)"
    if [[ "${RELAY_RECIPIENTS}" == "*" ]]; then
      RELAY_MODE=all
    else
      RELAY_MODE=list
      matching="$(recipients_regex "${RELAY_RECIPIENTS}")"
    fi
    # STARTTLS обязателен, сертификат проверяется (allow-insecure: false); в режиме list allowed-recipients
    # ограничивает и ручной «Release» из UI той же регуляркой (в режиме all не задаётся — наружу уходит всё)
    {
      printf '# relay Mailpit: генерирует bootstrap.sh из .env (MAIL_RELAY_*) — правки руками перезапишутся\n'
      printf 'host: %s\nport: %s\nstarttls: true\ntls: false\nallow-insecure: false\nauth: plain\n' \
        "$(yaml_quote "${host}")" "${port}"
      printf 'username: %s\n' "$(yaml_quote "${username}")"
      printf 'password: %s\n' "$(yaml_quote "${password}")"
      [[ -z "${matching}" ]] || printf 'allowed-recipients: %s\n' "$(yaml_quote "${matching}")"
    } >"${tmp}"
    RELAY_ACTIVE_MATCHING="${matching}"
    if [[ "${RELAY_MODE}" == "all" ]]; then
      log "почта: relay включён через ${host}:${port} (STARTTLS) — ВСЕМ получателям, копия в Mailpit"
    else
      log "почта: relay включён через ${host}:${port} (STARTTLS) — только адресам из MAIL_RELAY_RECIPIENTS, копия в Mailpit"
    fi
  fi
  chmod 600 "${tmp}"
  mv -f "${tmp}" "${RELAY_FILE}"
  RELAY_REV="$(openssl dgst -sha256 -r <"${RELAY_FILE}" | cut -c1-16)"
  echo "POKATIM_MAIL_RELAY=${RELAY_MODE}"
}

# ---------- 3–4. nginx и сертификат ----------

render_vhost() {
  local mode="$1"
  local cert_dir="/etc/letsencrypt/live/${PUBLIC_HOST}"
  printf '# pokatim dev: генерирует infra/deploy/bootstrap.sh на каждом деплое — правки руками перезапишутся\n'
  if [[ "${mode}" == "https" ]]; then
    cat <<EOF
# WebSocket UI Mailpit (/mail/api/events); имя переменной своё — map общий для http{} всех сайтов сервера
map \$http_upgrade \$pokatim_mail_connection {
    default upgrade;
    '' close;
}

server {
    listen 80;
    server_name ${PUBLIC_HOST};

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    # без http2 и default_server: в nginx < 1.25 (Ubuntu 24.04 — 1.24) параметры listen относятся ко всему
    # сокету *:443 — http2 здесь включил бы HTTP/2 всем соседним сайтам
    listen 443 ssl;
    server_name ${PUBLIC_HOST};

    ssl_certificate ${cert_dir}/fullchain.pem;
    ssl_certificate_key ${cert_dir}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:pokatim_ssl:10m;
    ssl_session_timeout 1d;
    # dev: короткий HSTS без includeSubDomains — не мешает смене домена
    add_header Strict-Transport-Security "max-age=86400" always;
EOF
  else
    cat <<EOF
# сертификата ещё нет: только :80 (cookie сессии web __Secure- без https не работает, docs/runbooks/deploy.md)
server {
    listen 80;
    server_name ${PUBLIC_HOST};

    location ^~ /.well-known/acme-challenge/ {
        root ${WEBROOT};
    }
EOF
  fi
  cat <<EOF

    server_tokens off;
    # dev-стенд не индексируется
    add_header X-Robots-Tag "noindex, nofollow" always;
    client_max_body_size 20m;
    gzip on;
    gzip_proxied any;
    gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;

    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    # клиентский адрес — только тот, что видит nginx (API: TRUST_PROXY=1)
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_set_header X-Forwarded-Host \$host;
    proxy_read_timeout 60s;

    location /v1/ {
        proxy_pass http://127.0.0.1:${API_PORT};
    }

    location = /admin {
        return 301 /admin/;
    }

    location /admin/ {
        proxy_pass http://127.0.0.1:${ADMIN_PORT};
    }
EOF
  if [[ "${mode}" == "https" ]]; then
    cat <<EOF

    # UI Mailpit (webroot /mail/, basic-auth самого Mailpit): письма стенда без SSH, наружу они не уходят
    location = /mail {
        return 301 /mail/;
    }

    location /mail/ {
        proxy_pass http://127.0.0.1:${MAIL_PORT};
        # proxy_set_header в location отменяет наследование заголовков server — они повторены
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$pokatim_mail_connection;
        # WebSocket событий открыт всё время, пока открыт UI
        proxy_read_timeout 1h;
    }
EOF
  else
    cat <<EOF

    # без https пароль basic-auth шёл бы открытым текстом: UI Mailpit — только SSH-туннель (runbook «Почта»)
    location = /mail {
        return 404;
    }

    location /mail/ {
        return 404;
    }
EOF
  fi
  cat <<EOF

    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
    }
}
EOF
}

# ставит vhost; при ошибке nginx -t возвращает прежний файл (или убирает свой) и падает
install_vhost() {
  local mode="$1" new backup had=0
  new="$(mktemp)"
  backup="$(mktemp)"
  render_vhost "${mode}" >"${new}"
  if sudo test -f "${SITE_FILE}"; then
    had=1
    # копия читается от root, пишется во временный файл текущего пользователя — так и задумано
    # shellcheck disable=SC2024
    sudo cat "${SITE_FILE}" >"${backup}"
    if cmp -s "${new}" "${backup}" && sudo test -L "${SITE_LINK}"; then
      log "nginx: vhost ${SITE_NAME} (${mode}) без изменений"
      rm -f "${new}" "${backup}"
      return 0
    fi
  fi
  sudo install -m 644 -o root -g root "${new}" "${SITE_FILE}"
  sudo ln -sfn "${SITE_FILE}" "${SITE_LINK}"
  if sudo nginx -t -q; then
    sudo systemctl reload nginx
    log "nginx: vhost ${SITE_NAME} (${mode}) установлен, reload"
    rm -f "${new}" "${backup}"
    return 0
  fi
  if [[ "${had}" -eq 1 ]]; then
    sudo install -m 644 -o root -g root "${backup}" "${SITE_FILE}"
  else
    sudo rm -f "${SITE_LINK}" "${SITE_FILE}"
  fi
  rm -f "${new}" "${backup}"
  sudo nginx -t -q || true
  die "nginx -t не прошёл с новым vhost ${SITE_NAME} — свой файл откачен, nginx не перезагружался"
}

# Какой файл отвечает на :<port> по умолчанию (запросы без SNI или с чужим Host): server с default_server,
# иначе первый по порядку включения (sites-enabled — по алфавиту). pokatim default быть не должен — иначе чужие
# запросы получат его сертификат и сайт; при таком раскладе — предупреждение, сам деплой этого не меняет.
default_vhost_file() {
  sudo nginx -T 2>/dev/null | awk -v port="$1" '
    /^# configuration file / { file = $4; sub(/:$/, "", file) }
    $1 == "listen" && $2 ~ ("(^|:)" port ";?$") {
      if (first == "") first = file
      if ($0 ~ /default_server/ && def == "") def = file
    }
    END { print (def != "" ? def : first) }'
}

check_not_default() {
  local port file
  for port in 80 443; do
    file="$(default_vhost_file "${port}")"
    if [[ "${file}" == "${SITE_LINK}" || "${file}" == "${SITE_FILE}" ]]; then
      warn "nginx: vhost ${SITE_NAME} — сервер по умолчанию для :${port} (нет default_server у соседей, ${SITE_NAME} первый по алфавиту) — runbook «nginx»"
    else
      # имя чужого файла в лог не выводится (лог Actions публичный)
      log "nginx: сервер по умолчанию для :${port} — не ${SITE_NAME}"
    fi
  done
}

cert_present() {
  sudo test -s "/etc/letsencrypt/live/${PUBLIC_HOST}/fullchain.pem" &&
    sudo test -s "/etc/letsencrypt/live/${PUBLIC_HOST}/privkey.pem"
}

# публичный IPv4 этого EC2 (IMDSv2); пусто — не определился
public_ip() {
  local token
  token="$(curl -fsS --max-time 2 -X PUT 'http://169.254.169.254/latest/api/token' \
    -H 'X-aws-ec2-metadata-token-ttl-seconds: 60' 2>/dev/null)" || return 0
  curl -fsS --max-time 2 -H "X-aws-ec2-metadata-token: ${token}" \
    'http://169.254.169.254/latest/meta-data/public-ipv4' 2>/dev/null || true
}

# HTTP-01 дойдёт до этого nginx: проба через webroot по имени хоста
acme_probe() {
  local name value dir="${WEBROOT}/.well-known/acme-challenge" got=""
  name="pokatim-probe-$(openssl rand -hex 8)"
  value="$(openssl rand -hex 16)"
  sudo mkdir -p "${dir}"
  printf '%s' "${value}" | sudo tee "${dir}/${name}" >/dev/null
  sudo chmod 644 "${dir}/${name}"
  got="$(curl -fsS --max-time 10 "http://${PUBLIC_HOST}/.well-known/acme-challenge/${name}" 2>/dev/null)" || true
  sudo rm -f "${dir}/${name}"
  [[ "${got}" == "${value}" ]]
}

domain_points_here() {
  local resolved ip
  resolved="$(getent ahostsv4 "${PUBLIC_HOST}" | awk '{ print $1 }' | sort -u | tr '\n' ' ')"
  if [[ -z "${resolved}" ]]; then
    warn "DNS: ${PUBLIC_HOST} не резолвится — сертификат не выпускается, сайт только по http (после A-записи — повторный деплой)"
    return 1
  fi
  ip="$(public_ip)"
  if [[ -n "${ip}" && " ${resolved}" == *" ${ip} "* ]]; then
    log "DNS: ${PUBLIC_HOST} → этот сервер"
    return 0
  fi
  if acme_probe; then
    log "DNS: ${PUBLIC_HOST} — проба HTTP-01 через этот nginx прошла"
    return 0
  fi
  # адреса в лог не выводятся (лог Actions публичный); сверить вручную — runbook «TLS»
  warn "DNS: ${PUBLIC_HOST} ведёт не на этот сервер — сертификат не выпускается"
  return 1
}

issue_cert() {
  command -v certbot >/dev/null 2>&1 || {
    warn "certbot не установлен — сертификат не выпускается"
    return 1
  }
  local account=(--register-unsafely-without-email)
  [[ -z "${CERTBOT_EMAIL:-}" ]] || account=(--email "${CERTBOT_EMAIL}" --no-eff-email)
  log "certbot: выпуск сертификата ${PUBLIC_HOST} (webroot ${WEBROOT})"
  # --cert-name: lineage строго live/<хост> (без -0001), его и проверяет cert_present
  if sudo certbot certonly --webroot -w "${WEBROOT}" -d "${PUBLIC_HOST}" --cert-name "${PUBLIC_HOST}" \
    --non-interactive --agree-tos "${account[@]}" --keep-until-expiring \
    --deploy-hook 'systemctl reload nginx'; then
    return 0
  fi
  warn "certbot не выпустил сертификат ${PUBLIC_HOST} (лимит Let's Encrypt, DNS, порт 80?) — сайт пока только по http; следующий деплой попробует снова"
  return 1
}

configure_nginx() {
  command -v nginx >/dev/null 2>&1 || die "nginx на хосте не найден"
  if [[ -n "${PREVIOUS_HOST}" && "${PREVIOUS_HOST}" != "${PUBLIC_HOST}" ]]; then
    log "домен сменился: ${PREVIOUS_HOST} → ${PUBLIC_HOST}"
    if sudo test -d "/etc/letsencrypt/live/${PREVIOUS_HOST}"; then
      warn "старый сертификат ${PREVIOUS_HOST} остался — удалить: sudo certbot delete --cert-name ${PREVIOUS_HOST}"
    fi
  fi
  local tls=http
  if cert_present; then
    install_vhost https
    tls=https
  else
    # сначала :80 с ACME-путём — нужен и certbot, и пробе
    install_vhost http
    if domain_points_here && issue_cert && cert_present; then
      install_vhost https
      tls=https
    fi
  fi
  check_not_default
  echo "POKATIM_TLS=${tls}"
}

PREVIOUS_HOST=""
ensure_env
ensure_mongo_keyfile
if [[ "${POKATIM_SKIP_NGINX:-0}" == "1" ]]; then
  log "POKATIM_SKIP_NGINX=1: nginx и сертификат пропущены"
  echo "POKATIM_TLS=skipped"
else
  configure_nginx
fi
