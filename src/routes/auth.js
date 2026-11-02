import { hashPassword, verifyPassword } from '../lib/password.js';
import { safeLocalPath, validateLogin, validateRegistration } from '../lib/validation.js';

const DUMMY_HASH_PROMISE = hashPassword('timing-equaliser');

function isUniqueViolation(err) {
  return err?.code === 'ERR_SQLITE_ERROR' && /UNIQUE constraint failed/.test(err.message);
}

export default async function authRoutes(app) {
  const { store } = app;

  const guestOnly = async (request, reply) => {
    if (request.user) return reply.redirect('/feed');
  };

  app.get('/register', { preHandler: guestOnly }, async (request, reply) =>
    reply.view('pages/register.hbs', { title: 'Регистрация', values: {}, errors: {} }),
  );

  app.post('/register', { preHandler: guestOnly }, async (request, reply) => {
    const { values, password, errors } = validateRegistration(request.body);

    if (!errors.username && store.isUsernameTaken(values.username)) {
      errors.username = 'Это имя пользователя уже занято.';
    }
    if (!errors.email && store.isEmailTaken(values.email)) {
      errors.email = 'Пользователь с такой почтой уже зарегистрирован.';
    }

    const render = () =>
      reply.code(422).view('pages/register.hbs', { title: 'Регистрация', values, errors, hasErrors: true });

    if (Object.keys(errors).length > 0) return render();

    let userId;
    try {
      userId = store.createUser({ ...values, passwordHash: await hashPassword(password) });
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      if (/users\.username/.test(err.message)) errors.username = 'Это имя пользователя уже занято.';
      else errors.email = 'Пользователь с такой почтой уже зарегистрирован.';
      return render();
    }

    return reply
      .logIn(userId)
      .flash('success', `Добро пожаловать, ${values.username}! Опубликуйте свою первую фотографию.`)
      .redirect('/feed');
  });

  app.get('/login', { preHandler: guestOnly }, async (request, reply) =>
    reply.view('pages/login.hbs', {
      title: 'Вход',
      values: {},
      next: safeLocalPath(request.query.next, ''),
    }),
  );

  app.post('/login', { preHandler: guestOnly }, async (request, reply) => {
    const { login, password } = validateLogin(request.body);
    const next = safeLocalPath(request.body?.next, '/feed');

    const user = login ? store.findUserForLogin(login) : undefined;
    let ok = false;
    if (user) ok = await verifyPassword(password, user.passwordHash);
    else await verifyPassword(password, await DUMMY_HASH_PROMISE);

    if (!ok) {
      return reply.code(401).view('pages/login.hbs', {
        title: 'Вход',
        values: { login },
        next: next === '/feed' ? '' : next,
        error: 'Неверное имя пользователя, почта или пароль.',
      });
    }

    return reply.logIn(user.id).redirect(next);
  });

  app.post('/logout', async (request, reply) => reply.logOut().redirect('/'));
}
