export const passwordMinLength = 8;
export const passwordMaxLength = 128;

export function meetsPasswordPolicy(value) {
  return typeof value === 'string' && value.length >= passwordMinLength && value.length <= passwordMaxLength
    && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
}
