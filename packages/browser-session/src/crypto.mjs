import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
export const randomToken = () => randomBytes(32).toString('base64url');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const challenge = verifier => createHash('sha256').update(verifier).digest('base64url');
export const equal = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
/** AES-GCM from Node's crypto library; ciphertext is bound to its record, type and deployment. */
export function seal(value, key, context) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function unseal(value, key, context) {
  if (typeof value !== 'string' || value.length > 32768) throw new Error('Invalid sealed record.');
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1' || parts.slice(1).some(v => !/^[\w-]+$/.test(v))) throw new Error('Invalid sealed record.');
  const [, iv, tag, body] = parts.map((v, i) => i ? Buffer.from(v, 'base64url') : v);
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid sealed record.');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAAD(Buffer.from(context)); decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8'));
}
