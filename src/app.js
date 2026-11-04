import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import Fastify from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import fastifyView from '@fastify/view';
import Handlebars from 'handlebars';

import { loadConfig } from './config.js';
import { openDatabase } from './db.js';
import { createStore } from './store.js';
import { registerHelpers } from './lib/view-helpers.js';
import { setupSession } from './plugins/session.js';
import { createStorage } from './storage/index.js';

import homeRoutes from './routes/home.js';
import authRoutes from './routes/auth.js';
import feedRoutes from './routes/feed.js';
import userRoutes from './routes/users.js';
import postRoutes from './routes/posts.js';
import settingsRoutes from './routes/settings.js';

const srcDir = dirname(fileURLToPath(import.meta.url));
const rootDir = join(srcDir, '..');
const require = createRequire(import.meta.url);
const packageDir = (name) => dirname(require.resolve(`${name}/package.json`));

const PARTIALS = {
  avatar: 'partials/avatar.hbs',
  pagination: 'partials/pagination.hbs',
  postCard: 'partials/post-card.hbs',
  followButton: 'partials/follow-button.hbs',
  photoGrid: 'partials/photo-grid.hbs',
};

export async function buildApp(overrides = {}, deps = {}) {
  const config = loadConfig(overrides);
  const app = Fastify({ logger: config.logger, trustProxy: config.trustProxy });

  const db = openDatabase(config.dbPath);
  const storage = deps.storage ?? createStorage(config);
  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('store', createStore(db));
  app.decorate('storage', storage);
  app.log.info({ driver: storage.driver }, 'image storage ready');
  app.addHook('onClose', async () => db.close());

  await app.register(fastifyCookie, { secret: config.cookieSecret });
  await app.register(fastifyFormbody, { bodyLimit: 64 * 1024 });
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: config.maxUploadBytes,
      files: 1,
      fields: 10,
      fieldSize: 16 * 1024,
      parts: 12,
    },
  });

  await app.register(fastifyStatic, { root: join(rootDir, 'public'), prefix: '/static/' });
  await app.register(fastifyStatic, {
    root: join(packageDir('bootstrap'), 'dist'),
    prefix: '/vendor/bootstrap/',
    decorateReply: false,
  });
  await app.register(fastifyStatic, {
    root: join(packageDir('bootstrap-icons'), 'font'),
    prefix: '/vendor/bootstrap-icons/',
    decorateReply: false,
  });
  if (storage.driver === 'local') {
    await app.register(fastifyStatic, {
      root: storage.dir,
      prefix: '/uploads/',
      decorateReply: false,
      maxAge: '365d',
      immutable: true,
    });
  }

  const handlebars = Handlebars.create();
  registerHelpers(handlebars);
  handlebars.registerHelper('mediaUrl', (name) => storage.url(name));
  await app.register(fastifyView, {
    engine: { handlebars },
    root: join(srcDir, 'views'),
    layout: 'layouts/main.hbs',
    production: config.isProduction,
    options: { partials: PARTIALS },
    defaultContext: { siteName: 'Hexlygram', year: new Date().getFullYear() },
  });

  setupSession(app);

  await app.register(homeRoutes);
  await app.register(authRoutes);
  await app.register(feedRoutes);
  await app.register(userRoutes);
  await app.register(postRoutes);
  await app.register(settingsRoutes);

  app.get('/favicon.ico', (request, reply) => reply.redirect('/static/favicon.svg', 301));

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).view('pages/error.hbs', {
      title: 'Страница не найдена',
      status: 404,
      message: 'Такой страницы нет. Возможно, она была удалена или ссылка неверна.',
    }),
  );

  app.setErrorHandler((err, request, reply) => {
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    if (status >= 500) request.log.error(err);
    else request.log.info({ err }, 'client error');

    return reply.code(status).view('pages/error.hbs', {
      title: status >= 500 ? 'Что-то пошло не так' : 'Ошибка запроса',
      status,
      message:
        status >= 500
          ? 'На сервере произошла ошибка. Попробуйте ещё раз чуть позже.'
          : 'Не удалось обработать запрос.',
    });
  });

  return app;
}
