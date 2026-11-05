import { BadRequestException } from '@nestjs/common';
import { DateTime } from 'luxon';

export function directorySearch(value = '') {
  const accents: Record<string, string> = {
    a: '[aáàäâãå]',
    e: '[eéèëê]',
    i: '[iíìïî]',
    o: '[oóòöôõ]',
    u: '[uúùüû]',
    n: '[nñ]',
  };
  return value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .split(/\s+/)
    .map((word) => [...word].map((char) => accents[char] || char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''))
    .join('\\s+');
}

export function directoryPage(total: number, page = 1, pageSize = 25) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(page, pages);
  return { total, page: current, pageSize, pages, offset: (current - 1) * pageSize };
}

export function reserveDirectoryFilter(
  query: { search?: string; from?: string; to?: string; court?: string; turn?: string },
  now: Date,
) {
  const local = DateTime.fromJSDate(now, { zone: 'America/Santiago' });
  for (const value of [query.from, query.to].filter(Boolean)) {
    const parsed = DateTime.fromISO(value, { zone: 'America/Santiago' });
    if (!parsed.isValid || parsed.toISODate() !== value) throw new BadRequestException('Fecha invalida.');
  }
  if (query.from && query.to && query.from > query.to)
    throw new BadRequestException('El inicio debe ser anterior al fin del rango.');
  const today = local.toISODate();
  const from = query.from && query.from > today ? query.from : today;
  const end = { $substrBytes: [{ $ifNull: ['$turn', ''] }, 6, 5] };
  const filter: Record<string, unknown> = {
    state: true,
    dateToPlay: { $gte: from, ...(query.to ? { $lte: query.to } : {}) },
    $and: [
      {
        $or: [
          { dateToPlay: { $gt: today } },
          {
            dateToPlay: today,
            $expr: { $gt: [{ $cond: [{ $eq: [end, '00:00'] }, '24:00', end] }, local.toFormat('HH:mm')] },
          },
        ],
      },
    ],
  };
  if (query.court) filter.court = query.court;
  if (query.turn) filter.turn = query.turn;
  const search = directorySearch(query.search);
  if (search)
    filter.$or = ['player1', 'player2', 'player3', 'player4', 'visitName'].map((field) => ({
      [field]: { $regex: search, $options: 'i' },
    }));
  return filter;
}
