import { passwordMaxLength, passwordMinLength } from '../../../../shared/password-policy.mjs';

export { meetsPasswordPolicy, passwordMaxLength, passwordMinLength } from '../../../../shared/password-policy.mjs';
export const passwordHint = `От ${passwordMinLength} до ${passwordMaxLength} символов, минимум одна строчная латинская буква, одна прописная латинская буква и одна цифра.`;
