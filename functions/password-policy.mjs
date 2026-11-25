export const passwordMinLength = 8;
export const passwordMaxLength = 128;

export function meetsPasswordPolicy(value) {
  return typeof value === 'string' && value.length >= passwordMinLength && value.length <= passwordMaxLength
    && /\p{Ll}/u.test(value) && /\p{Lu}/u.test(value) && /[0-9]/.test(value);
}
