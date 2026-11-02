import { buildApp } from './app.js';

const app = await buildApp();

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    app.log.info(`${signal} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}

try {
  await app.listen({ host: app.config.host, port: app.config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
