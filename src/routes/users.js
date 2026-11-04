import { buildPagination, parsePage } from '../lib/pagination.js';
import { requireUser } from '../plugins/session.js';
import { safeLocalPath } from '../lib/validation.js';

export default async function userRoutes(app) {
  const { store, config } = app;

  app.get('/u/:username', async (request, reply) => {
    const profile = store.findUserByUsername(request.params.username);
    if (!profile) return reply.callNotFound();

    if (profile.username !== request.params.username) {
      return reply.redirect(`/u/${encodeURIComponent(profile.username)}`, 301);
    }

    const stats = store.getUserStats(profile.id);
    const pageSize = config.profilePageSize;
    const baseUrl = `/u/${encodeURIComponent(profile.username)}`;
    const pagination = buildPagination({
      page: parsePage(request.query.page),
      pageSize,
      total: stats.posts,
      baseUrl,
    });
    const posts = store.listUserPosts({
      userId: profile.id,
      limit: pageSize,
      offset: (pagination.page - 1) * pageSize,
    });

    const viewer = request.user;
    const isOwn = viewer?.id === profile.id;

    return reply.view('pages/profile.hbs', {
      title: profile.username,
      profile: { ...profile },
      stats,
      posts,
      pagination,
      isOwn,
      isFollowing: viewer && !isOwn ? store.isFollowing(viewer.id, profile.id) : false,
      back: request.url,
    });
  });

  const followAction = (follow) => async (request, reply) => {
    const target = store.findUserByUsername(request.params.username);
    if (!target) return reply.callNotFound();

    const back = safeLocalPath(request.body?.back, `/u/${encodeURIComponent(target.username)}`);
    if (target.id === request.user.id) {
      return reply.flash('warning', 'Нельзя подписаться на самого себя.').redirect(back);
    }

    if (follow) store.follow(request.user.id, target.id);
    else store.unfollow(request.user.id, target.id);

    return reply.redirect(back);
  };

  app.post('/u/:username/follow', { preHandler: requireUser }, followAction(true));
  app.post('/u/:username/unfollow', { preHandler: requireUser }, followAction(false));
}
