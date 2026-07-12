const partsInZone = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(value.year), month: Number(value.month), day: Number(value.day), hour: Number(value.hour), minute: Number(value.minute) };
};

export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function supportedTimeZones(): string[] {
  const values = (Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }).supportedValuesOf?.('timeZone') ?? [];
  return Array.from(new Set(['UTC', browserTimeZone(), ...values]));
}

export function localDateTimeValue(isoValue: string, timeZone: string): string {
  const value = partsInZone(new Date(isoValue), timeZone);
  return `${value.year}-${String(value.month).padStart(2, '0')}-${String(value.day).padStart(2, '0')}T${String(value.hour).padStart(2, '0')}:${String(value.minute).padStart(2, '0')}`;
}

export function utcFromLocalDateTime(localValue: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(localValue);
  if (!match) throw new Error('Enter a valid date and time.');
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  let candidate = desired;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const value = partsInZone(new Date(candidate), timeZone);
    const represented = Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute);
    const difference = represented - desired;
    if (!difference) break;
    candidate -= difference;
  }
  return new Date(candidate).toISOString();
}
