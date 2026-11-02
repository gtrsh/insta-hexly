export const USERNAME_RE = /^[a-zA-Z0-9_.]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const str = (value) => (typeof value === 'string' ? value : '');

export const charLength = (value) => [...value].length;

export function validateRegistration(body = {}) {
  const values = {
    username: str(body.username).trim(),
    email: str(body.email).trim().toLowerCase(),
  };
  const password = str(body.password);
  const passwordConfirm = str(body.passwordConfirm);
  const errors = {};

  if (!USERNAME_RE.test(values.username)) {
    errors.username = 'Имя пользователя: 3-30 символов, латинские буквы, цифры, «_» и «.».';
  } else if (/^\.|\.$|\.\./.test(values.username)) {
    errors.username = 'Точка не может стоять в начале, в конце или повторяться.';
  }

  if (!EMAIL_RE.test(values.email) || values.email.length > 254) {
    errors.email = 'Введите корректный адрес электронной почты.';
  }

  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    errors.password = `Пароль должен содержать от ${PASSWORD_MIN} до ${PASSWORD_MAX} символов.`;
  } else if (password !== passwordConfirm) {
    errors.passwordConfirm = 'Пароли не совпадают.';
  }

  return { values, password, errors };
}

export function validateLogin(body = {}) {
  return { login: str(body.login).trim(), password: str(body.password) };
}

export function validateCaption(value, maxLength) {
  const caption = str(value).replace(/\r\n/g, '\n').trim();
  const error =
    charLength(caption) > maxLength ? `Описание не должно превышать ${maxLength} символов.` : null;
  return { caption, error };
}

export function safeLocalPath(value, fallback = '/') {
  const path = str(value);
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
  return path;
}
