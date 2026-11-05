import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminDirectoryController } from './admin-directory.controller';
import { MembersDirectoryQueryDto, ReservesDirectoryQueryDto } from './admin-directory.dto';
import { directoryPage, directorySearch, reserveDirectoryFilter } from './admin-directory.policy';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { AdminGuard } from '../auth/guards/admin.guard';

describe('Administrative directory query contract', () => {
  it('searches accented names literally without allowing regex operators', () => {
    expect(new RegExp(directorySearch('  jose   zuniga '), 'i').test('José Zúñiga')).toBe(true);
    expect(new RegExp(directorySearch('JOSE'), 'i').test('josé')).toBe(true);
    expect(new RegExp(directorySearch('.*'), 'i').test('Any person')).toBe(false);
    expect(new RegExp(directorySearch('[A]'), 'i').test('[Á]')).toBe(true);
    expect(directorySearch(' ')).toBe('');
  });

  it('defaults to 25 rows and clamps an obsolete page after deletion or filtering', () => {
    expect(directoryPage(51)).toEqual({ total: 51, page: 1, pageSize: 25, pages: 3, offset: 0 });
    expect(directoryPage(25, 2)).toEqual({ total: 25, page: 1, pageSize: 25, pages: 1, offset: 0 });
    expect(directoryPage(0, 100, 50)).toEqual({ total: 0, page: 1, pageSize: 50, pages: 1, offset: 0 });
  });

  it('validates pagination and whitelist filters rather than accepting arbitrary Mongo operators', async () => {
    expect(
      await validate(
        plainToInstance(MembersDirectoryQueryDto, {
          page: '2',
          pageSize: '50',
          state: 'active',
          memberType: 'Carga',
          access: 'blocked',
        }),
      ),
    ).toHaveLength(0);
    for (const input of [
      { page: '0' },
      { page: 'abc' },
      { pageSize: '5000' },
      { state: 'deleted' },
      { access: '$where' },
    ]) {
      expect((await validate(plainToInstance(MembersDirectoryQueryDto, input))).length).toBeGreaterThan(0);
    }
    expect(
      (
        await validate(
          plainToInstance(ReservesDirectoryQueryDto, { court: 'Cancha 8', turn: 'anything', from: 'yesterday' }),
        )
      ).length,
    ).toBe(3);
  });

  it('rejects impossible dates and inverted ranges', () => {
    expect(() => reserveDirectoryFilter({ from: '2026-02-30' }, new Date())).toThrow('Fecha invalida');
    expect(() => reserveDirectoryFilter({ from: '2026-11-10', to: '2026-11-01' }, new Date())).toThrow('El inicio');
  });

  it('keeps only active future slots, with midnight treated as the next day', () => {
    const filter = reserveDirectoryFilter(
      { search: 'José', court: 'Cancha 3', turn: '22:15-00:00' },
      new Date('2026-11-05T22:30:00Z'),
    );
    expect(filter.state).toBe(true);
    expect(filter.dateToPlay).toEqual({ $gte: '2026-11-05' });
    expect(filter.court).toBe('Cancha 3');
    expect(filter.turn).toBe('22:15-00:00');
    expect(filter.$or).toHaveLength(5);
    expect(JSON.stringify(filter.$and)).toContain('24:00');
    expect(JSON.stringify(filter.$and)).toContain('19:30');
  });

  it('all directory routes require JWT and administrative role', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminDirectoryController)).toEqual([JwtAuthGuard, AdminGuard]);
  });
});
