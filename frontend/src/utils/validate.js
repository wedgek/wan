export function isPhone(str) { return /^1[3-9]\d{9}$/.test(str) }
export function isEmail(str) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str) }
export function isEmpty(value) { return value === null || value === undefined || value === '' }