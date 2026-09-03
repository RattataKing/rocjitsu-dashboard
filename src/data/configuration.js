import { hasDisplayValue } from '../utils/values';

function displayValue(value) {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  return null;
}

function displayKey(key) {
  const words = String(key)
    .replaceAll(/[_-]+/g, ' ')
    .replaceAll(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLocaleLowerCase();
  return words.replace(/^./, (character) => character.toUpperCase());
}

export function configurationDetails(test = {}) {
  const details = [];
  const seenKeys = new Set();
  const addDetail = (key, value) => {
    const normalizedKey = hasDisplayValue(key) ? String(key).trim() : '';
    const normalizedValue = displayValue(value);
    if (!normalizedKey || !hasDisplayValue(normalizedValue) || seenKeys.has(normalizedKey)) return;
    seenKeys.add(normalizedKey);
    details.push({ key: normalizedKey, label: displayKey(normalizedKey), value: normalizedValue });
  };

  if (Array.isArray(test.configuration)) {
    test.configuration.forEach((detail) => {
      if (detail && typeof detail === 'object') addDetail(detail.key, detail.value);
    });
  }
  if (details.length > 0) return details;

  addDetail('operation', test.operation);
  addDetail('dataType', test.dataType?.toUpperCase());
  Object.entries(test.problem ?? {}).forEach(([key, value]) => addDetail(key, value));
  addDetail('executionMode', test.execMode);
  addDetail('threads', test.numThreads);
  return details;
}
