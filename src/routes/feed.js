import { buildPagination, parsePage } from '../lib/pagination.js';

export default async function feedRoutes(app) {
  const { store, config } = app;

  app.get('/feed', async (request, reply) => {
    const pageSize = config.feedPageSize;
    const pagination = buildPagination({
      page: parsePage(request.query.page),
      pageSize,
      total: store.countAllPosts(),
      baseUrl: '/feed',
    });

    const viewerId = request.user?.id ?? 0;
    const posts = store
      .listFeed({ limit: pageSize, offset: (pagination.page - 1) * pageSize, viewerId })
      .map((post) => ({ ...post, isOwn: post.authorId === viewerId, isFollowing: post.isFollowing === 1 }));

    return reply.view('pages/feed.hbs', {
      title: 'Лента',
      posts,
      pagination,
      back: request.url,
    });
  });
}
