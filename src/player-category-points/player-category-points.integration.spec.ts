import * as mongoose from 'mongoose';
import { PlayerCategoryPoints, PlayerCategoryPointsSchema } from './entities/player-category-points.entity';
import { Register, RegisterSchema } from '../register/entities/register.entity';
import { PlayerCategoryPointsService } from './player-category-points.service';

const uri = process.env.CATEGORY_TEST_MONGO_URI;
(uri ? describe : describe.skip)('Member category transactions with isolated MongoDB', () => {
  let connection: mongoose.Connection;
  let members: mongoose.Model<Register>;
  let categories: mongoose.Model<PlayerCategoryPoints>;
  let service: PlayerCategoryPointsService;
  const email = 'member@test.invalid';
  beforeAll(async () => {
    const target = new URL(uri);
    if (target.hostname !== '127.0.0.1' || !/^\/ctq_category_test_/.test(target.pathname)) throw new Error('Only an isolated localhost test database is allowed.');
    connection = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 10000 }).asPromise();
    members = connection.model(Register.name, RegisterSchema);
    categories = connection.model(PlayerCategoryPoints.name, PlayerCategoryPointsSchema);
    await Promise.all([members.init(), categories.init()]);
    service = new PlayerCategoryPointsService(categories as any, members);
  });
  beforeEach(async () => {
    await members.deleteMany({});
    await categories.deleteMany({});
    await members.create({ namePlayer: 'Socio ficticio', email, cellular: 'test-phone', pwd: 'not-a-real-password', statePlayer: true });
    await categories.create([
      { playerEmail: email, category: '2', points: 180, isActive: true },
      { playerEmail: email, category: '1', points: 90, isActive: false },
      { playerEmail: email, category: 'Dobles', points: 30, isActive: true },
      { playerEmail: email, category: 'Legacy', points: 15, isActive: true },
    ]);
  });
  afterAll(async () => {
    if (connection) {
      await connection.dropDatabase();
      await connection.close();
    }
  });
  const save = async (activeCategories: string[], pointAdjustments: { category: string; points: number }[] = []) => {
    const editor = await service.getEditor(email);
    return service.saveAssignments(email, { revision: editor.revision, activeCategories, pointAdjustments });
  };
  it('switches principal and keeps historical points without transferring them', async () => {
    const result = await save(['3', 'Dobles']);
    expect(result.categories).toEqual(
      expect.arrayContaining([
        { category: '2', points: 180, isActive: false },
        { category: '1', points: 90, isActive: false },
        { category: '3', points: 0, isActive: true },
        { category: 'Dobles', points: 30, isActive: true },
        { category: 'Legacy', points: 15, isActive: true },
      ]),
    );
  });
  it('reactivates the category with its preserved points', async () => {
    const result = await save(['1']);
    expect(result.categories.find((row) => row.category === '1')).toEqual({ category: '1', points: 90, isActive: true });
    expect(result.categories.find((row) => row.category === 'Dobles').points).toBe(30);
  });
  it('applies only explicit point adjustments, including zero', async () => {
    const result = await save(['1', 'Dobles'], [{ category: '1', points: 0 }]);
    expect(result.categories.find((row) => row.category === '1').points).toBe(0);
    expect(result.categories.find((row) => row.category === '2').points).toBe(180);
  });
  it('allows no principal and multiple additional categories', async () => {
    const result = await save(['Damas', '+55']);
    expect(result.categories.filter((row) => ['1', '2', '3', '4'].includes(row.category) && row.isActive)).toHaveLength(0);
    expect(result.categories.find((row) => row.category === '2').points).toBe(180);
  });
  it('rejects two principals without changing any records', async () => {
    const before = await service.getEditor(email);
    await expect(service.saveAssignments(email, { revision: before.revision, activeCategories: ['1', '2'], pointAdjustments: [] })).rejects.toMatchObject({ status: 400 });
    expect((await service.getEditor(email)).revision).toBe(before.revision);
  });
  it('detects points changed by the ranking and rolls back the member lock', async () => {
    const before = await service.getEditor(email);
    const version = (await members.findOne({ email }).lean()).__v;
    await categories.updateOne({ playerEmail: email, category: '2' }, { $set: { points: 181 } });
    await expect(service.saveAssignments(email, { revision: before.revision, activeCategories: ['1'], pointAdjustments: [] })).rejects.toMatchObject({ status: 409 });
    expect((await members.findOne({ email }).lean()).__v).toBe(version);
    expect((await categories.findOne({ playerEmail: email, category: '2' })).points).toBe(181);
  });
  it('allows only one concurrent save from the same revision', async () => {
    const before = await service.getEditor(email);
    const results = await Promise.allSettled(['1', '3'].map((category) => service.saveAssignments(email, { revision: before.revision, activeCategories: [category], pointAdjustments: [] })));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.status).toBe(409);
    const result = await service.getEditor(email);
    expect(result.categories.filter((row) => ['1', '2', '3', '4'].includes(row.category) && row.isActive)).toHaveLength(1);
  });
  it('rolls back all category changes if a later write fails', async () => {
    const before = await service.getEditor(email);
    const original = categories.updateOne.bind(categories);
    let writes = 0;
    const spy = jest.spyOn(categories, 'updateOne').mockImplementation(((...args: any[]) => {
      if (++writes === 2) throw new Error('isolated write failure');
      return original(...(args as [any, any, any]));
    }) as any);
    try {
      await expect(service.saveAssignments(email, { revision: before.revision, activeCategories: ['1'], pointAdjustments: [{ category: '1', points: 12 }] })).rejects.toThrow('isolated write failure');
    } finally {
      spy.mockRestore();
    }
    expect((await service.getEditor(email)).revision).toBe(before.revision);
  });
  it('rejects inactive and nonexistent members', async () => {
    const before = await service.getEditor(email);
    await members.updateOne({ email }, { $set: { statePlayer: false } });
    await expect(service.saveAssignments(email, { revision: before.revision, activeCategories: ['1'], pointAdjustments: [] })).rejects.toMatchObject({ status: 400 });
    await expect(service.getEditor('missing@test.invalid')).rejects.toMatchObject({ status: 404 });
    expect((await service.getEditor(email)).revision).toBe(before.revision);
  });
  it('the legacy add route cannot create a second principal', async () => {
    await expect(service.addCategoryToPlayer(email, '1')).rejects.toMatchObject({ status: 400 });
  });
});
