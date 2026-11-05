import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as mongoose from 'mongoose';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { CourtReserveController } from '../src/court-reserve/court-reserve.controller';
import { CourtReserveService } from '../src/court-reserve/court-reserve.service';
import { CourtReserve, CourtReserveSchema } from '../src/court-reserve/entities/court-reserve.entity';
import { Register, RegisterSchema } from '../src/register/entities/register.entity';

async function main() {
  const [uri, outputArg] = process.argv.slice(2);
  assert(uri && outputArg, 'Usage: ts-node test/reservation-history.e2e.ts ISOLATED_URI OUTPUT');
  const target = new URL(uri);
  assert(
    target.hostname === '127.0.0.1' && /^\/ctq_history_test_[a-zA-Z0-9_]+$/.test(target.pathname),
    'Disposable loopback database required',
  );
  const output = resolve(outputArg);
  await mkdir(output, { recursive: true });
  const connection = await mongoose
    .createConnection(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 })
    .asPromise();
  const checks: string[] = [];
  const check = (value: unknown, message: string) => {
    assert(value, message);
    checks.push(message);
  };
  const report: Record<string, unknown> = {
    executedAt: new Date().toISOString(),
    checks,
    scope: 'Real HTTP/Nest/JWT/MongoDB, synthetic history; no AppModule, cron, SMTP or payments',
  };
  let app;
  try {
    const members = connection.model(Register.name, RegisterSchema);
    const reserves = connection.model(CourtReserve.name, CourtReserveSchema);
    await members.collection.insertMany([
      {
        email: 'owner@example.invalid',
        namePlayer: 'Current Fixture Name',
        role: 'user',
        statePlayer: true,
        updatePayment: false,
      },
      { email: 'other@example.invalid', namePlayer: 'Unrelated Player', role: 'user', statePlayer: true },
      { email: 'inactive@example.invalid', namePlayer: 'Current Fixture Name', statePlayer: false },
      { email: 'empty@example.invalid', namePlayer: 'No Reservations', statePlayer: true },
    ]);
    const records = Array.from({ length: 61 }, (_, i) => ({
      idCourtReserve: `history-${i}`,
      court: `Cancha ${(i % 3) + 1}`,
      dateToPlay: `2030-11-${String(1 + (i % 28)).padStart(2, '0')}`,
      turn: '08:15-10:00',
      state: i % 5 !== 0,
      [`player${(i % 4) + 1}`]: 'Current Fixture Name',
      passCourtReserve: 'must-not-leak',
      ownerEmail: 'private@example.invalid',
    }));
    await reserves.collection.insertMany([
      ...records,
      { ...records[0], idCourtReserve: 'unrelated', player1: 'Unrelated Player' },
    ]);
    const config = { get: (key: string) => (key === 'SECRET_KEY' ? 'isolated-history-secret' : undefined) };
    const service = new CourtReserveService(
      reserves as any,
      { findOneByEmail: (email) => members.findOne({ email }) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: config.get('SECRET_KEY') }),
      ],
      controllers: [CourtReserveController],
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: config },
        { provide: CourtReserveService, useValue: service },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const jwt = module.get(JwtService),
      base = await app.getUrl();
    const token = jwt.sign({ email: 'owner@example.invalid', role: 'user', namePlayer: 'Unrelated Player' });
    const call = async (query = '', auth: string | null = token) => {
      const response = await fetch(`${base}/court-reserve/my-history${query}`, {
        headers: auth ? { Authorization: `Bearer ${auth}` } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    const snapshot = async () => JSON.stringify(await reserves.collection.find({}).sort({ _id: 1 }).toArray());
    const before = await snapshot();
    check((await call('', null)).status === 401, 'Missing JWT rejected');
    check(
      (await call('', jwt.sign({ email: 'owner@example.invalid' }, { expiresIn: -1 }))).status === 401,
      'Expired JWT rejected',
    );
    check(
      (await call('', jwt.sign({ email: 'inactive@example.invalid' }))).status === 403,
      'Inactive account rejected',
    );
    check((await call('', jwt.sign({ email: 'deleted@example.invalid' }))).status === 403, 'Deleted account rejected');
    const first = await call();
    check(
      first.status === 200 && first.body.items.length === 25 && first.body.total === 61 && first.body.cancelled === 13,
      'Default page has 25 records and complete total/cancelled counts despite financial restriction',
    );
    check(
      first.body.items.every((row) =>
        ['player1', 'player2', 'player3', 'player4'].some((field) => row[field] === 'Current Fixture Name'),
      ),
      'Persisted session identity selects all four participant positions; ignores token name',
    );
    check(
      !JSON.stringify(first.body).includes('must-not-leak') &&
        !JSON.stringify(first.body).includes('private@example.invalid'),
      'Projection excludes access code and owner email',
    );
    const second = await call('?page=2'),
      third = await call('?page=3');
    check(
      second.body.items.length === 25 && third.body.items.length === 11 && third.body.pages === 3,
      'All pages have expected bounded sizes',
    );
    const all = [...first.body.items, ...second.body.items, ...third.body.items];
    check(
      new Set(all.map((row) => row.idCourtReserve)).size === 61,
      'Adjacent pages contain no duplicates or missing reservations',
    );
    check(
      all.every((row, i) => !i || all[i - 1].dateToPlay >= row.dateToPlay),
      'History remains newest date first',
    );
    check((await call('?page=999')).body.page === 3, 'Obsolete page clamps to final page');
    check(
      (await call('?pageSize=50')).body.items.length === 50 && (await call('?pageSize=100')).body.items.length === 61,
      '50 and 100 row page sizes supported',
    );
    for (const query of [
      '?page=0',
      '?pageSize=500',
      '?email=other@example.invalid',
      '?namePlayer=Unrelated%20Player',
    ]) {
      check((await call(query)).status === 400, `Invalid or foreign-identity query rejected: ${query}`);
    }
    const empty = await call('?page=9', jwt.sign({ email: 'empty@example.invalid' }));
    check(
      empty.body.items.length === 0 && empty.body.total === 0 && empty.body.cancelled === 0 && empty.body.page === 1,
      'Empty history returns zero counts and page one',
    );
    const other = await call('', jwt.sign({ email: 'other@example.invalid' }));
    check(
      other.body.total === 1 && other.body.items[0].idCourtReserve === 'unrelated',
      'Another session sees only its own history',
    );
    check((await snapshot()) === before, 'Reading paginated history does not change any reservation');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = error.stack;
    process.exitCode = 1;
  } finally {
    await app?.close();
    await connection.dropDatabase();
    await connection.close();
    report.disposableDatabaseDropped = true;
    await writeFile(resolve(output, 'validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ status: report.status, checks: checks.length, failure: report.failure }));
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
