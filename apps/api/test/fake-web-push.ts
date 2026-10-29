import { createDecipheriv, createECDH, hkdfSync, randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/** Подписчик Web Push (как браузер): пара ECDH P-256 и секрет `auth`; `keys` — то, что браузер отдаёт серверу. */
export interface WebPushSubscriber {
  ecdh: ReturnType<typeof createECDH>;
  authSecret: Buffer;
  keys: { p256dh: string; auth: string };
}

export function webPushSubscriber(): WebPushSubscriber {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    ecdh,
    authSecret,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: authSecret.toString('base64url'),
    },
  };
}

const info = (label: string) => Buffer.from(`Content-Encoding: ${label}\0`, 'ascii');

/** Расшифровка aes128gcm стороной браузера (RFC 8291): независимая от отправителя сборка ключей. */
export function decryptWebPush(body: Buffer, subscriber: WebPushSubscriber): Buffer {
  const salt = body.subarray(0, 16);
  const idLength = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idLength);
  const sealed = body.subarray(21 + idLength);
  const uaPublic = subscriber.ecdh.getPublicKey();
  const shared = subscriber.ecdh.computeSecret(asPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'ascii'), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, subscriber.authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, info('aes128gcm'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, info('nonce'), 12));
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(sealed.subarray(sealed.length - 16));
  const padded = Buffer.concat([
    decipher.update(sealed.subarray(0, sealed.length - 16)),
    decipher.final(),
  ]);
  const end = padded.lastIndexOf(2);
  if (end < 0) throw new Error('no record delimiter');
  return padded.subarray(0, end);
}

export interface FakeWebPushCall {
  path: string;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

/**
 * Фейковый push-сервис (FCM/Mozilla/Apple) на 127.0.0.1: подписка — путь `/sub/<n>`; принимает POST, пишет вызовы и
 * отвечает статусом из `statuses` (по умолчанию 201). `subscription(n)` — подписка для `push_tokens` и подписчик для
 * расшифровки.
 */
export class FakeWebPush {
  readonly calls: FakeWebPushCall[] = [];
  readonly statuses = new Map<string, number>();
  private readonly subscribers = new Map<string, WebPushSubscriber>();

  constructor(
    private readonly server: Server,
    readonly origin: string,
  ) {}

  subscription(name: string): { endpoint: string; keys: WebPushSubscriber['keys'] } {
    let subscriber = this.subscribers.get(name);
    if (!subscriber) {
      subscriber = webPushSubscriber();
      this.subscribers.set(name, subscriber);
    }
    return { endpoint: `${this.origin}/sub/${name}`, keys: subscriber.keys };
  }

  /** Расшифрованные payload, пришедшие подписке `name`. */
  payloadsOf(name: string): unknown[] {
    const subscriber = this.subscribers.get(name);
    if (!subscriber) return [];
    return this.calls
      .filter((call) => call.path === `/sub/${name}`)
      .map((call) => JSON.parse(decryptWebPush(call.body, subscriber).toString('utf8')) as unknown);
  }

  reset(): void {
    this.calls.length = 0;
    this.statuses.clear();
    this.subscribers.clear();
  }

  stop(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }
}

export async function startFakeWebPush(): Promise<FakeWebPush> {
  let fake: FakeWebPush | null = null;
  const server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on('data', (chunk: Buffer) => parts.push(chunk));
    req.on('end', () => {
      const path = req.url ?? '/';
      fake!.calls.push({ path, headers: req.headers, body: Buffer.concat(parts) });
      const name = path.replace(/^\/sub\//, '');
      res.statusCode = fake!.statuses.get(name) ?? 201;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  fake = new FakeWebPush(server, `http://127.0.0.1:${port}`);
  return fake;
}
