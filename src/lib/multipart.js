const LIMIT_ERRORS = new Set(['FST_REQ_FILE_TOO_LARGE', 'FST_FILES_LIMIT', 'FST_FIELDS_LIMIT', 'FST_PARTS_LIMIT']);

export class UploadError extends Error {}

export async function readMultipart(request, { fileField, maxBytes }) {
  if (!request.isMultipart()) throw new UploadError('Форма должна быть отправлена как multipart/form-data.');

  const fields = {};
  let file = null;

  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        const buffer = await part.toBuffer();
        if (part.fieldname === fileField && buffer.length > 0 && !file) {
          file = { buffer, filename: part.filename, mimetype: part.mimetype };
        }
      } else {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (err) {
    if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new UploadError(`Файл слишком большой. Максимальный размер - ${Math.round(maxBytes / 1024 / 1024)} МБ.`);
    }
    if (LIMIT_ERRORS.has(err.code)) throw new UploadError('Слишком много данных в форме.');
    throw err;
  }

  return { fields, file };
}
