import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { DateTime } from 'luxon';
import * as mongoose from 'mongoose';
import { JwtStrategy } from '../src/auth/strategies/jwt.strategy';
import { Register, RegisterSchema } from '../src/register/entities/register.entity';
import { CourtReserve, CourtReserveSchema } from '../src/court-reserve/entities/court-reserve.entity';
import { MembershipDue, MembershipDueSchema } from '../src/membership-billing/entities/membership-due.entity';
import {
  MembershipBillingConfig,
  MembershipBillingConfigSchema,
} from '../src/membership-billing/entities/membership-billing-config.entity';
import { proposedBillingConfiguration } from '../src/membership-billing/billing.types';
import { AdminDirectoryService } from '../src/admin-directory/admin-directory.service';
import { AdminDirectoryController } from '../src/admin-directory/admin-directory.controller';

async function main() {
  const [uri, outputArg, frontendArg, playwrightArg] = process.argv.slice(2);
  assert(uri && outputArg, 'Usage: ts-node test/admin-directory.e2e.ts ISOLATED_URI OUTPUT [FRONTEND PLAYWRIGHT]');
  const target = new URL(uri);
  assert(
    target.hostname === '127.0.0.1' && /^\/ctq_directory_test_[a-zA-Z0-9_]+$/.test(target.pathname),
    'Only an isolated loopback directory database is allowed',
  );
  const output = resolve(outputArg);
  await mkdir(output, { recursive: true });
  const checks: string[] = [];
  const check = (value: unknown, message: string) => {
    assert(value, message);
    checks.push(message);
  };
  const connection = await mongoose
    .createConnection(uri, { autoCreate: false, autoIndex: false, serverSelectionTimeoutMS: 10000 })
    .asPromise();
  let app;
  let enabled = true;
  const report: Record<string, unknown> = {
    executedAt: new Date().toISOString(),
    scope: 'Disposable localhost MongoDB, real Nest/JWT and synthetic club records; no SMTP or provider',
    checks,
  };
  try {
    const members = connection.model(Register.name, RegisterSchema);
    const reserves = connection.model(CourtReserve.name, CourtReserveSchema);
    const dues = connection.model(MembershipDue.name, MembershipDueSchema);
    const configs = connection.model(MembershipBillingConfig.name, MembershipBillingConfigSchema);
    const now = DateTime.now().setZone('America/Santiago');
    const people = Array.from({ length: 61 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      namePlayer: `Socio ${String(i).padStart(3, '0')}`,
      email: `socio${i}@example.invalid`,
      cellular: `+569${String(i).padStart(8, '0')}`,
      role: i === 0 ? 'admin' : 'user',
      statePlayer: i !== 2,
      updatePayment: i !== 3,
      partnerType: i % 2 ? 'Carga' : 'Titular',
      pwd: 'fixture-not-used-for-login',
      verificationToken: 'must-not-leak',
      billingStartPeriod: '2026-10',
    }));
    people[59].namePlayer = 'José Zúñiga Fixture';
    people[59].partnerType = 'Familiar';
    people[60].namePlayer = 'Titular Fuera de Página';
    await members.collection.insertMany(people);
    const configuration = {
      ...proposedBillingConfiguration(),
      autoBlockEnabled: true,
      activation: { migrationReviewed: true },
    };
    await configs.collection.insertOne(configuration);
    const openDue = {
      _id: new mongoose.Types.ObjectId(),
      beneficiaryId: people[1]._id,
      period: '2026-10',
      dueAt: now.minus({ days: 1 }).toJSDate(),
      status: 'OPEN',
      amount: 50,
      currency: 'CLP',
      pricingMode: 'TEST',
    };
    await dues.collection.insertOne(openDue);
    const upcoming = Array.from({ length: 61 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      idCourtReserve: `fixture-${i}`,
      passCourtReserve: 'secret-fixture',
      court: `Cancha ${(i % 3) + 1}`,
      dateToPlay: now.plus({ days: 1 + Math.floor(i / 8) }).toISODate(),
      turn: [
        '08:15-10:00',
        '10:15-12:00',
        '12:15-14:00',
        '14:15-16:00',
        '16:15-18:00',
        '18:15-20:00',
        '20:15-22:00',
        '22:15-00:00',
      ][i % 8],
      player1: `Jugador ${String(i).padStart(3, '0')}`,
      player2: i === 60 ? 'José Zúñiga Fixture' : 'Rival Fixture',
      state: true,
    }));
    await reserves.collection.insertMany([
      ...upcoming,
      { ...upcoming[0], _id: new mongoose.Types.ObjectId(), idCourtReserve: 'cancelled', state: false },
      {
        ...upcoming[0],
        _id: new mongoose.Types.ObjectId(),
        idCourtReserve: 'expired',
        dateToPlay: now.minus({ days: 1 }).toISODate(),
      },
    ]);
    const config = {
      get: (key: string) =>
        key === 'SECRET_KEY'
          ? 'directory-isolated-secret'
          : key === 'MEMBERSHIP_PORTAL_ENABLED' && enabled
            ? 'true'
            : undefined,
    };
    const module = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({ secret: config.get('SECRET_KEY') }),
      ],
      controllers: [AdminDirectoryController],
      providers: [
        AdminDirectoryService,
        JwtStrategy,
        { provide: ConfigService, useValue: config },
        { provide: getModelToken(Register.name), useValue: members },
        { provide: getModelToken(CourtReserve.name), useValue: reserves },
        { provide: getModelToken(MembershipDue.name), useValue: dues },
        { provide: getModelToken(MembershipBillingConfig.name), useValue: configs },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const jwt = module.get(JwtService);
    const token = jwt.sign({ email: people[0].email, role: 'admin' }, { expiresIn: '1h' });
    const snapshot = async () =>
      JSON.stringify(
        await Promise.all(
          [members.collection, reserves.collection, dues.collection, configs.collection].map((collection) =>
            collection.find({}).sort({ _id: 1 }).toArray(),
          ),
        ),
      );
    const beforeReads = await snapshot();
    const call = async (path: string, authorization: string | null = token) => {
      const response = await fetch(`${base}/admin-directory/${path}`, {
        headers: authorization ? { Authorization: `Bearer ${authorization}` } : {},
      });
      return { status: response.status, body: await response.json() };
    };
    check((await call('members', null)).status === 401, 'Missing JWT is rejected');
    check(
      (await call('members', jwt.sign({ email: people[0].email, role: 'admin' }, { expiresIn: -1 }))).status === 401,
      'Expired JWT is rejected',
    );
    check(
      (await call('members', jwt.sign({ email: people[1].email, role: 'admin' }))).status === 403,
      'Stale admin role claims cannot replace the stored role',
    );
    check(
      (await call('members', jwt.sign({ email: people[1].email, role: 'user' }))).status === 403,
      'A member cannot use administrative listings',
    );
    check(
      (await call('members', jwt.sign({ email: people[2].email, role: 'admin' }))).status === 403,
      'Inactive or stale administrative claims are rejected by stored account state',
    );
    const first = await call('members');
    check(
      first.status === 200 && first.body.items.length === 25 && first.body.total === 61 && first.body.pages === 3,
      'Default pagination returns 25 of 61 users',
    );
    const large = await call('members?pageSize=100');
    check(
      large.body.items.length === 61 && large.body.pages === 1,
      'The supported 100-row page size is applied by the backend',
    );
    check(
      !JSON.stringify(first.body).includes('pwd') && !JSON.stringify(first.body).includes('must-not-leak'),
      'Projection excludes passwords and verification tokens',
    );
    const second = await call('members?page=2');
    check(
      second.body.items.every((row) => !first.body.items.some((firstRow) => firstRow._id === row._id)),
      'Adjacent pages have no duplicates',
    );
    const search = await call('members?search=jose%20zuniga&memberType=Carga&state=active');
    check(
      search.body.total === 1 && search.body.items[0]._id === String(people[59]._id),
      'Accent-insensitive search spans all pages and includes legacy Familiar as Carga',
    );
    const blocked = await call('members?access=blocked&state=active');
    check(
      blocked.body.items.some(
        (row) => row._id === String(people[1]._id) && row.reservationBlockReason === 'OVERDUE_DUES',
      ),
      'Effective filter recognizes overdue dues even with the manual payment flag on',
    );
    check(
      blocked.body.items.some(
        (row) => row._id === String(people[3]._id) && row.reservationBlockReason === 'LEGACY_ACCESS_REVIEW',
      ),
      'Manual restriction remains distinct from overdue dues',
    );
    check(
      blocked.body.items.every((row) => row.statePlayer),
      'Active-account filtering is independent of reservation restriction',
    );
    const titulares = await call(`titulares?excludeId=${people[59]._id}&currentId=${people[2]._id}`);
    check(
      titulares.body.some((row) => row._id === String(people[60]._id)),
      'Titular candidates are independent of the visible page',
    );
    check(
      titulares.body.some((row) => row._id === String(people[2]._id) && !row.statePlayer),
      'The inactive existing association remains identifiable without becoming eligible',
    );
    check(
      (await call('members?pageSize=500')).status === 400 && (await call('members?unknown=1')).status === 400,
      'Invalid pagination and unknown query fields are rejected',
    );
    check((await call('members?page=999')).body.page === 3, 'An obsolete page is clamped to the last page');
    const reservations = await call('reserves');
    check(
      reservations.status === 200 && reservations.body.total === 61 && reservations.body.items.length === 25,
      'Only active upcoming reservations participate in pagination',
    );
    check(!JSON.stringify(reservations.body).includes('secret-fixture'), 'Reservation access codes are never returned');
    const partners = await call('reserves?search=jose%20zuniga');
    check(
      partners.body.total === 1 && partners.body.items[0].idCourtReserve === 'fixture-60',
      'Reservation search includes partner names outside the first page',
    );
    const combination = await call(
      `reserves?from=${upcoming[0].dateToPlay}&to=${upcoming[0].dateToPlay}&court=Cancha%201&turn=08%3A15-10%3A00`,
    );
    check(combination.body.total === 1, 'Date, court and turn filters combine before pagination');
    check(
      (await call('reserves?from=2026-02-30')).status === 400,
      'Invalid calendar dates produce a controlled validation error',
    );
    enabled = false;
    const legacy = await call(`members?search=${people[1].email}&access=allowed`);
    check(legacy.body.total === 1, 'Portal-disabled access preserves the existing legacy permission policy');
    enabled = true;
    if (frontendArg && playwrightArg) {
      const front = resolve(frontendArg);
      const buildDir = resolve(output, 'build');
      const build = spawnSync(
        process.execPath,
        [resolve(front, 'node_modules/vite/bin/vite.js'), 'build', '--outDir', buildDir],
        {
          cwd: front,
          env: { ...process.env, VITE_API_URL: 'https://api.ctq-directory.example.invalid' },
          encoding: 'utf8',
          maxBuffer: 8e6,
        },
      );
      await writeFile(resolve(output, 'build.log'), build.stdout + build.stderr);
      assert.equal(build.status, 0, 'Frontend build must pass');
      const browser = await new Promise<{ status: number; stdout: string; stderr: string }>((resolveRun, reject) => {
        const child = spawn(
          process.execPath,
          [
            resolve(front, 'tests/e2e/adminDirectory.mjs'),
            buildDir,
            resolve(output, 'browser'),
            resolve(playwrightArg),
            base,
            token,
          ],
          { cwd: front },
        );
        let stdout = '',
          stderr = '';
        child.stdout.on('data', (data) => {
          stdout += data;
        });
        child.stderr.on('data', (data) => {
          stderr += data;
        });
        child.on('error', reject);
        child.on('close', (status) => resolveRun({ status: status ?? 1, stdout, stderr }));
      });
      await writeFile(resolve(output, 'browser.log'), browser.stdout + browser.stderr);
      check(browser.status === 0, `Connected frontend browser verification: ${browser.stdout.trim()}`);
    }
    check(
      (await members.countDocuments()) === 61 &&
        (await reserves.countDocuments()) === 63 &&
        (await dues.countDocuments()) === 1,
      'Read-only listings never create, delete or alter fixture business rows',
    );
    check(
      (await snapshot()) === beforeReads,
      'Full fixture snapshots remain byte-identical after API and browser reads',
    );
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
