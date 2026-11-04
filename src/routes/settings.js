import { detectImageType } from '../lib/images.js';
import { removeQuietly } from '../storage/index.js';
import { readMultipart, UploadError } from '../lib/multipart.js';
import { requireUser } from '../plugins/session.js';

export default async function settingsRoutes(app) {
  const { store, config, storage } = app;

  const renderSettings = (request, reply, { error = null, status = 200 } = {}) =>
    reply.code(status).view('pages/settings.hbs', {
      title: 'Настройки профиля',
      profile: { ...store.findUserById(request.user.id) },
      error,
      maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
    });

  app.get('/settings', { preHandler: requireUser }, async (request, reply) => renderSettings(request, reply));

  app.post('/settings/avatar', { preHandler: requireUser }, async (request, reply) => {
    let upload;
    try {
      upload = await readMultipart(request, { fileField: 'avatar', maxBytes: config.maxUploadBytes });
    } catch (err) {
      if (err instanceof UploadError) return renderSettings(request, reply, { error: err.message, status: 422 });
      throw err;
    }

    if (!upload.file) return renderSettings(request, reply, { error: 'Выберите изображение.', status: 422 });

    const ext = detectImageType(upload.file.buffer);
    if (!ext) {
      return renderSettings(request, reply, {
        error: 'Поддерживаются только изображения JPEG, PNG, GIF и WebP.',
        status: 422,
      });
    }

    const previous = store.findUserById(request.user.id).avatar;
    const avatar = await storage.save(upload.file.buffer, ext);
    store.setAvatar(request.user.id, avatar);
    await removeQuietly(storage, previous, request.log);

    return reply.flash('success', 'Аватар обновлён.').redirect('/settings');
  });

  app.post('/settings/avatar/delete', { preHandler: requireUser }, async (request, reply) => {
    const previous = store.findUserById(request.user.id).avatar;
    store.setAvatar(request.user.id, null);
    await removeQuietly(storage, previous, request.log);

    return reply.flash('success', 'Аватар удалён.').redirect('/settings');
  });
}
