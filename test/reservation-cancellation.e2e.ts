import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { DateTime, Settings } from 'luxon';
import * as mongoose from 'mongoose';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { CourtReserveController } from '../src/court-reserve/court-reserve.controller';
import { CourtReserveService } from '../src/court-reserve/court-reserve.service';
import { ReservationSlotService } from '../src/court-reserve/reservation-slot.service';
import { CourtReserve, CourtReserveSchema } from '../src/court-reserve/entities/court-reserve.entity';
import { ReservationSlot, ReservationSlotSchema } from '../src/court-reserve/entities/reservation-slot.entity';
import { Register, RegisterSchema } from '../src/register/entities/register.entity';

async function main() {
  const [uri, outputArg] = process.argv.slice(2);
  assert(uri && outputArg, 'Usage: ts-node test/reservation-cancellation.e2e.ts ISOLATED_URI OUTPUT');
  const target = new URL(uri);
  assert(
    target.hostname === '127.0.0.1' && /^\/ctq_cancel_test_[a-zA-Z0-9_]+$/.test(target.pathname),
    'Only an isolated loopback cancellation database is allowed',
  );
  const output = resolve(outputArg);
  await mkdir(output, { recursive: true });
  const connection = await mongoose
    .createConnection(uri, {
      autoCreate: false,
      autoIndex: false,
      serverSelectionTimeoutMS: 10000,
    })
    .asPromise();
  let app;
  const previousClock = Settings.now;
  const fixed = DateTime.fromISO('2030-11-05T10:00:00-03:00').toMillis();
  Settings.now = () => fixed;
  const checks: string[] = [];
  const report: Record<string, unknown> = {
    executedAt: new Date().toISOString(),
    checks,
    scope:
      'Real HTTP/Nest/JWT/MongoDB and slot service; synthetic records, no cron, SMTP, payment provider or AppModule',
  };
  const check = (value: unknown, message: string) => {
    assert(value, message);
    checks.push(message);
  };
  try {
    const members = connection.model(Register.name, RegisterSchema);
    const reserves = connection.model(CourtReserve.name, CourtReserveSchema);
    const slots = connection.model(ReservationSlot.name, ReservationSlotSchema);
    const people = [
      {
        email: 'owner@example.invalid',
        namePlayer: 'Owner Fixture',
        role: 'user',
        statePlayer: true,
        updatePayment: false,
      },
      { email: 'other@example.invalid', namePlayer: 'Player One Fixture', role: 'user', statePlayer: true },
      { email: 'admin@example.invalid', namePlayer: 'Admin Fixture', role: 'admin', statePlayer: true },
      { email: 'inactive@example.invalid', namePlayer: 'Inactive Fixture', role: 'admin', statePlayer: false },
    ];
    await members.collection.insertMany(people);
    const baseline = {
      court: 'Cancha 1',
      dateToPlay: '2030-11-06',
      turn: '10:15-12:00',
      state: true,
      ownerEmail: 'owner@example.invalid',
      player1: 'Player One Fixture',
      player2: 'Owner Fixture',
    };
    const fixtures = [
      { ...baseline, idCourtReserve: 'owned' },
      { ...baseline, idCourtReserve: 'legacy', ownerEmail: null },
      { ...baseline, idCourtReserve: 'started', dateToPlay: '2030-11-05', turn: '10:00-12:00' },
      { ...baseline, idCourtReserve: 'expired', dateToPlay: '2030-11-04' },
      { ...baseline, idCourtReserve: 'parallel', turn: '12:15-14:00' },
    ];
    await reserves.collection.insertMany(fixtures);
    await slots.collection.insertMany(
      fixtures.map((row, i) => ({
        _id: `slot-${i}`,
        reservationId: row.idCourtReserve,
        court: row.court,
        dateToPlay: row.dateToPlay,
        turn: row.turn,
        status: 'CONFIRMED',
        expiresAt: new Date(fixed),
      })) as any,
    );
    const config = { get: (key: string) => (key === 'SECRET_KEY' ? 'isolated-cancellation-secret' : undefined) };
    const slotService = new ReservationSlotService(slots as any, reserves as any, config as any);
    // Bind only the exercised methods: this harness never starts the reconciliation timer.
    const slotAdapter: any = Object.fromEntries(
      ['acquire', 'confirm', 'releaseConfirmed', 'releaseUnstarted', 'pendingForDate'].map((key) => [
        key,
        slotService[key].bind(slotService),
      ]),
    );
    const effects = { audits: 0, cancellationMail: 0, confirmationMail: 0 };
    const audit: any = {
      logReserveCancellation: async () => {
        effects.audits++;
      },
      logReserveCreation: async () => undefined,
    };
    const register: any = {
      findOneByEmail: (email: string) => members.findOne({ email }),
      findOneEmail: (namePlayer: string) => members.findOne({ namePlayer }),
    };
    const service = new CourtReserveService(reserves as any, register, {} as any, audit, {} as any, slotAdapter);
    service.sendEmailRemove = async () => {
      effects.cancellationMail++;
    };
    service.sendEmailReserve = async () => {
      effects.confirmationMail++;
    };
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
    const base = await app.getUrl();
    const jwt = module.get(JwtService);
    const owner = jwt.sign({ email: people[0].email, role: 'user' });
    const other = jwt.sign({ email: people[1].email, role: 'admin' });
    const admin = jwt.sign({ email: people[2].email, role: 'user' });
    const call = async (id: string, token: string | null, body?: Record<string, unknown>) => {
      const response = await fetch(`${base}/court-reserve/${id}`, {
        method: body ? 'POST' : 'DELETE',
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const snapshot = async () =>
      JSON.stringify([
        await reserves.collection.find({}).sort({ _id: 1 }).toArray(),
        await slots.collection.find({}).sort({ _id: 1 }).toArray(),
        effects,
      ]);
    const beforeDenied = await snapshot();
    check((await call('owned', null)).status === 401, 'No token: cancellation rejected');
    check((await call('owned', 'invalid')).status === 401, 'Invalid token: cancellation rejected');
    check(
      (await call('owned', jwt.sign({ email: people[0].email }, { expiresIn: -1 }))).status === 401,
      'Expired token: cancellation rejected',
    );
    check((await call('owned', jwt.sign({ role: 'admin' }))).status === 401, 'Token without identity rejected');
    check(
      (await call('owned', jwt.sign({ email: people[3].email, role: 'admin' }))).status === 403,
      'Inactive administrator rejected',
    );
    check(
      (await call('owned', jwt.sign({ email: 'deleted@example.invalid', role: 'admin' }))).status === 403,
      'Deleted account rejected',
    );
    check(
      (await call('owned', other)).status === 403,
      'Stored role prevails over stale admin claim; Player 1 is not creator',
    );
    check((await call('legacy', owner)).status === 403, 'No creator: participant cannot cancel');
    check((await call('legacy', other)).status === 403, 'No creator: Player 1 cannot cancel');
    check((await call('started', owner)).status === 403, 'Creator cannot cancel at turn start');
    check((await call('expired', owner)).status === 403, 'Creator cannot cancel a past turn');
    check((await call('missing', owner)).status === 404, 'Unknown reservation returns 404');
    check((await snapshot()) === beforeDenied, 'Denied requests leave all reservations, slots and effects unchanged');
    check(
      (await call('owned', owner)).status === 200,
      'Active creator can cancel despite manual financial restriction',
    );
    check(
      (await reserves.findOne({ idCourtReserve: 'owned' }).lean()).state === false &&
        (await slots.findOne({ reservationId: 'owned' }).lean()).status === 'RELEASED',
      'Authorized cancellation persists inactive state and releases its confirmed slot',
    );
    const afterFirst = { ...effects };
    check((await call('owned', owner)).status === 409, 'Repeated cancellation returns conflict');
    check(
      JSON.stringify(afterFirst) === JSON.stringify(effects),
      'Repeated cancellation does not repeat email or audit',
    );
    check((await call('legacy', admin)).status === 200, 'Stored active administrator can cancel legacy reservation');
    check(
      (await call('expired', admin)).status === 200,
      'Stored active administrator can cancel regardless of deadline',
    );
    check((await call('started', admin)).status === 200, 'Administrator can cancel a turn already in progress');
    const beforeConcurrent = effects.audits;
    // Two requests exercise the atomic claim against MongoDB, not a mocked write.
    const first = call('parallel', owner);
    const second = call('parallel', owner);
    const statuses = [(await first).status, (await second).status].sort();
    check(
      JSON.stringify(statuses) === '[200,409]' && effects.audits === beforeConcurrent + 1,
      'Concurrent cancellations produce one state transition and one audit',
    );
    const dto = {
      court: 'Cancha 3',
      dateToPlay: '2030-11-07',
      turn: '08:15-10:00',
      player1: 'Player One Fixture',
      player2: 'Owner Fixture',
      ownerEmail: 'forged@example.invalid',
    };
    check((await call('', null, dto)).status === 401, 'Normal creation also requires JWT');
    const created = await call('', owner, dto);
    check(created.status === 201, 'Normal creation uses the existing booking service');
    const persisted = await reserves.findOne({ idCourtReserve: created.body.idCourtReserve }).lean();
    check(
      persisted?.ownerEmail === people[0].email && persisted.player1 === dto.player1,
      'New reservation persists authenticated creator, never body owner or Player 1',
    );
    check(
      (await call(persisted.idCourtReserve, other)).status === 403,
      'Player 1 cannot cancel the new reservation created by someone else',
    );
    check(
      (await call(persisted.idCourtReserve, owner)).status === 200,
      'Authenticated creator can cancel the newly created reservation',
    );
    report.status = 'passed';
    report.effects = effects;
  } catch (error) {
    report.status = 'failed';
    report.failure = error.stack;
    process.exitCode = 1;
  } finally {
    Settings.now = previousClock;
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
