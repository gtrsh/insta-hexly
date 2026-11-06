import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { contentTypeFor, IMAGE_CONTENT_TYPES, newImageName } from '../lib/images.js';

const CACHE_CONTROL = 'public, max-age=31536000, immutable';

export function createS3Storage({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  forcePathStyle,
  prefix = '',
  publicUrl = '',
  client,
}) {
  const s3 =
    client ??
    new S3Client({
      endpoint,
      region,
      forcePathStyle,
      credentials: { accessKeyId, secretAccessKey },
    });

  const keyFor = (name) => `${prefix}${name}`;
  const publicBase = publicUrl.replace(/\/+$/, '');

  return {
    driver: 's3',
    bucket,
    prefix,
    client: s3,
    servesThroughApp: !publicBase,

    async save(buffer, ext) {
      const name = newImageName(ext);
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: keyFor(name),
          Body: buffer,
          ContentLength: buffer.length,
          ContentType: IMAGE_CONTENT_TYPES[ext],
          CacheControl: CACHE_CONTROL,
        }),
      );
      return name;
    },

    async remove(name) {
      if (!name) return;
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: keyFor(name) }));
    },

    async get(name, { ifNoneMatch } = {}) {
      try {
        const res = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: keyFor(name), IfNoneMatch: ifNoneMatch || undefined }),
        );
        return {
          body: res.Body,
          contentType: res.ContentType || contentTypeFor(name),
          contentLength: res.ContentLength,
          etag: res.ETag,
          lastModified: res.LastModified,
          cacheControl: res.CacheControl || CACHE_CONTROL,
        };
      } catch (err) {
        const status = err.$metadata?.httpStatusCode;
        if (status === 304 || err.name === 'NotModified') return { notModified: true };
        if (status === 404 || err.name === 'NoSuchKey' || err.name === 'NotFound') return null;
        throw err;
      }
    },

    url: (name) => (publicBase ? `${publicBase}/${keyFor(name)}` : `/uploads/${name}`),
  };
}
