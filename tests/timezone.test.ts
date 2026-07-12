import { expect, it } from 'vitest';
import { localDateTimeValue, utcFromLocalDateTime } from '../src/domain/timezone';

it('displays UTC reminder instants in the preferred time zone', () => {
  expect(localDateTimeValue('2026-07-13T00:00:00.000Z', 'America/Los_Angeles')).toBe('2026-07-12T17:00');
});

it('converts edited preferred-zone times back to UTC', () => {
  expect(utcFromLocalDateTime('2026-07-12T17:00', 'America/Los_Angeles')).toBe('2026-07-13T00:00:00.000Z');
});
