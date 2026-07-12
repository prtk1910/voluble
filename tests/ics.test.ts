import { describe, expect, it } from 'vitest';
import { createRecord } from '../src/domain/record';
import { generateIcs, googleCalendarUrl } from '../src/domain/ics';

it('generates portable ICS and a user-initiated Google Calendar link', () => {
  const record = createRecord({ title: 'Review, plan', content: 'Line one\nLine two', event: { start: '2026-07-12T20:00:00.000Z', end: '2026-07-12T21:00:00.000Z', allDay: false } });
  expect(generateIcs(record)).toContain('SUMMARY:Review\\, plan');
  expect(generateIcs(record)).toContain('DESCRIPTION:Line one\\nLine two');
  expect(googleCalendarUrl(record)).toContain('calendar.google.com/calendar/render');
});
