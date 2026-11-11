export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.name = 'ApiError'; this.status = status; this.code = code; }
}
export const denied = () => new ApiError(404, 'NOT_FOUND', 'Resource not found or access unavailable.');
export function object(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype)
    throw new ApiError(400, 'INVALID_INPUT', 'A JSON object is required.');
  if (Object.keys(value).some(key => !allowed.includes(key)))
    throw new ApiError(400, 'UNKNOWN_FIELD', 'Unexpected input field.');
  return value;
}
export function uuid(value) {
  if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))
    throw new ApiError(400, 'INVALID_ID', 'A UUID is required.');
  return value.toLowerCase();
}
