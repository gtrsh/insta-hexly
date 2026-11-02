import { createHash, randomBytes } from 'node:crypto';

const SESSION_COOKIE = 'sid';
const FLASH_COOKIE = 'flash';
const STATIC_PREFIXES = ['/static/', '/vendor/', '/uploads/', '/favicon'];
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const hashToken = (token) => createHash('sha256').update(token).digest('hex');

export function setupSession(app) {
  const { store, config } = app;

  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    signed: true,
  };

  app.decorateRequest('user', null);

  app.decorateReply('logIn', function logIn(userId) {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = Date.now() + config.sessionTtlMs;
    store.createSession(hashToken(token), userId, expiresAt);
    this.setCookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge: Math.floor(config.sessionTtlMs / 1000) });
    return this;
  });

  app.decorateReply('logOut', function logOut() {
    const token = readSigned(this.request, SESSION_COOKIE);
    if (token) store.deleteSession(hashToken(token));
    this.clearCookie(SESSION_COOKIE, cookieOptions);
    return this;
  });

  app.decorateReply('flash', function flash(type, message) {
    this.setCookie(FLASH_COOKIE, JSON.stringify({ type, message }), cookieOptions);
    return this;
  });

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url;
    if (STATIC_PREFIXES.some((prefix) => path.startsWith(prefix))) return;

    if (UNSAFE_METHODS.has(request.method) && !isSameOrigin(request)) {
      reply.code(403).type('text/plain; charset=utf-8').send('Запрос отклонён: неверный источник.');
      return reply;
    }

    const token = readSigned(request, SESSION_COOKIE);
    if (token) {
      const user = store.findSessionUser(hashToken(token));
      if (user) request.user = { ...user };
      else reply.clearCookie(SESSION_COOKIE, cookieOptions);
    }

    let flash = null;
    if (request.method === 'GET') {
      const raw = readSigned(request, FLASH_COOKIE);
      if (raw) {
        try {
          flash = JSON.parse(raw);
        } catch {
          flash = null;
        }
      }
      if (request.cookies[FLASH_COOKIE] !== undefined) reply.clearCookie(FLASH_COOKIE, cookieOptions);
    }

    reply.locals = { currentUser: request.user, flash };
  });

  store.purgeExpiredSessions();
  const timer = setInterval(() => store.purgeExpiredSessions(), 60 * 60 * 1000);
  timer.unref();
  app.addHook('onClose', async () => clearInterval(timer));
}

function readSigned(request, name) {
  const raw = request.cookies[name];
  if (!raw) return null;
  const { valid, value } = request.unsignCookie(raw);
  return valid ? value : null;
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin || origin === 'null') return origin !== 'null';
  try {
    return new URL(origin).host === new URL(`${request.protocol}://${request.host}`).host;
  } catch {
    return false;
  }
}

export async function requireUser(request, reply) {
  if (request.user) return;
  if (request.method === 'GET') {
    return reply.redirect(`/login?next=${encodeURIComponent(request.url)}`);
  }
  return reply.redirect('/login');
}
