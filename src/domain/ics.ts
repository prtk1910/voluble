import type { VolubleRecord } from './record.js';

const escape = (value: string) => value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const stamp = (value: string) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function generateIcs(record: VolubleRecord): string {
  if (!record.event) throw new Error('An event is required to generate an ICS file.');
  const start = stamp(record.event.start);
  const end = stamp(record.event.end ?? new Date(new Date(record.event.start).getTime() + 60 * 60 * 1000).toISOString());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Voluble//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${record.id}@voluble`, `DTSTAMP:${stamp(record.updatedAt)}`,
    `DTSTART:${start}`, `DTEND:${end}`, `SUMMARY:${escape(record.title)}`,
    `DESCRIPTION:${escape(record.content)}`,
    ...(record.event.location ? [`LOCATION:${escape(record.event.location)}`] : []),
    'END:VEVENT', 'END:VCALENDAR', ''
  ];
  return lines.join('\r\n');
}

export function googleCalendarUrl(record: VolubleRecord): string {
  if (!record.event) throw new Error('An event is required to create a calendar link.');
  const end = record.event.end ?? new Date(new Date(record.event.start).getTime() + 60 * 60 * 1000).toISOString();
  return `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: 'TEMPLATE', text: record.title,
    dates: `${stamp(record.event.start)}/${stamp(end)}`,
    details: record.content,
    location: record.event.location ?? ''
  })}`;
}
