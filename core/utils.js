export function randomInRange(min, max) {
  return Math.random() * (max - min) + min;
}

export function generateId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cloneContext(value) {
  try {
    return JSON.parse(JSON.stringify(value || {}));
  } catch (error) {
    return {};
  }
}

export function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function sanitizeJsonValue(value) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    return undefined;
  }

  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (Array.isArray(value)) {
    return value.map((item) => {
      const sanitizedItem = sanitizeJsonValue(item);
      return sanitizedItem === undefined ? null : sanitizedItem;
    });
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const sanitizedObject = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    const sanitizedNestedValue = sanitizeJsonValue(nestedValue);
    if (sanitizedNestedValue !== undefined) {
      sanitizedObject[key] = sanitizedNestedValue;
    }
  }

  return sanitizedObject;
}
