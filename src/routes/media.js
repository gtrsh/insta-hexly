import { IMAGE_NAME_RE } from '../lib/images.js';

export default async function mediaRoutes(app, { storage }) {
  app.get('/uploads/:name', async (request, reply) => {
    const { name } = request.params;
    if (!IMAGE_NAME_RE.test(name)) return reply.callNotFound();

    const object = await storage.get(name, { ifNoneMatch: request.headers['if-none-match'] });
    if (!object) return reply.callNotFound();
    if (object.notModified) return reply.code(304).send();

    reply
      .header('content-type', object.contentType)
      .header('cache-control', object.cacheControl)
      .header('x-content-type-options', 'nosniff');
    if (object.etag) reply.header('etag', object.etag);
    if (object.lastModified) reply.header('last-modified', object.lastModified.toUTCString());
    if (object.contentLength != null) reply.header('content-length', object.contentLength);

    return reply.send(object.body);
  });
}
