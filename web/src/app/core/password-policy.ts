import { passwordMaxLength, passwordMinLength } from '../../../../functions/password-policy.mjs';

export { meetsPasswordPolicy, passwordMaxLength, passwordMinLength } from '../../../../functions/password-policy.mjs';
export const passwordHint = `От ${passwordMinLength} до ${passwordMaxLength} символов, минимум одна строчная буква, одна прописная буква и одна цифра.`;
