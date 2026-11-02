export default async function homeRoutes(app) {
  app.get('/', async (request, reply) => {
    if (request.user) return reply.redirect('/feed');

    return reply.view('pages/home.hbs', {
      title: 'Делитесь моментами',
      latest: app.store.latestImages(6),
    });
  });
}
