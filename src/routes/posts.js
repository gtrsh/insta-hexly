import { detectImageType } from '../lib/images.js';
import { removeQuietly } from '../storage/index.js';
import { readMultipart, UploadError } from '../lib/multipart.js';
import { requireUser } from '../plugins/session.js';
import { validateCaption } from '../lib/validation.js';

export default async function postRoutes(app) {
  const { store, config, storage } = app;

  const renderForm = (reply, { caption = '', error = null, status = 200 } = {}) =>
    reply.code(status).view('pages/new-post.hbs', {
      title: 'Новая публикация',
      caption,
      error,
      captionMax: config.captionMaxLength,
      maxUploadMb: Math.round(config.maxUploadBytes / 1024 / 1024),
    });

  app.get('/posts/new', { preHandler: requireUser }, async (request, reply) => renderForm(reply));

  app.post('/posts', { preHandler: requireUser }, async (request, reply) => {
    let upload;
    try {
      upload = await readMultipart(request, { fileField: 'image', maxBytes: config.maxUploadBytes });
    } catch (err) {
      if (err instanceof UploadError) return renderForm(reply, { error: err.message, status: 422 });
      throw err;
    }

    const { caption, error: captionError } = validateCaption(upload.fields.caption, config.captionMaxLength);
    if (captionError) return renderForm(reply, { caption, error: captionError, status: 422 });

    if (!upload.file) return renderForm(reply, { caption, error: 'Выберите изображение.', status: 422 });

    const ext = detectImageType(upload.file.buffer);
    if (!ext) {
      return renderForm(reply, {
        caption,
        error: 'Поддерживаются только изображения JPEG, PNG, GIF и WebP.',
        status: 422,
      });
    }

    const image = await storage.save(upload.file.buffer, ext);
    let postId;
    try {
      postId = store.createPost({ userId: request.user.id, image, caption });
    } catch (err) {
      await removeQuietly(storage, image, request.log);
      throw err;
    }

    return reply.flash('success', 'Публикация добавлена.').redirect(`/p/${postId}`);
  });

  app.get('/p/:id', async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    const viewerId = request.user?.id ?? 0;
    const post = Number.isSafeInteger(id) && id > 0 ? store.findPost(id, viewerId) : undefined;
    if (!post) return reply.callNotFound();

    return reply.view('pages/post.hbs', {
      title: `Публикация ${post.authorUsername}`,
      post: { ...post, isOwn: post.authorId === viewerId, isFollowing: post.isFollowing === 1 },
      back: request.url,
    });
  });

  app.post('/p/:id/delete', { preHandler: requireUser }, async (request, reply) => {
    const id = Number.parseInt(request.params.id, 10);
    const post = Number.isSafeInteger(id) ? store.findPost(id) : undefined;
    if (!post || post.authorId !== request.user.id) return reply.callNotFound();

    store.deletePost(post.id, request.user.id);
    await removeQuietly(storage, post.image, request.log);

    return reply
      .flash('success', 'Публикация удалена.')
      .redirect(`/u/${encodeURIComponent(request.user.username)}`);
  });
}
