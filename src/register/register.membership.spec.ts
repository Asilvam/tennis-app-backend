import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { RegisterService } from './register.service';
import { TipoSocio } from './enums/tipo-socio.enum';

const memberId = '000000000000000000000001';
const titularId = '000000000000000000000002';
function query(read: () => any): any {
  const value = { select: () => value, lean: () => value, session: () => value, exec: async () => read(), then: (yes, no) => value.exec().then(yes, no) };
  return value;
}

function fixture(type = TipoSocio.TITULAR) {
  let rows: any[] = [
    { _id: new Types.ObjectId(memberId), email: 'member@test.cl', namePlayer: 'Member', partnerType: type, __v: 0, role: 'profesor', statePlayer: false, updatePayment: false },
    { _id: new Types.ObjectId(titularId), email: 'titular@test.cl', namePlayer: 'Titular', partnerType: TipoSocio.TITULAR, __v: 0 },
  ];
  const matches = (row, filter) => Object.entries(filter).every(([key, value]) => row[key]?.toString() === value?.toString());
  const session = { id: 'test-session' };
  const model: any = {
    findOne: jest.fn(filter => query(() => rows.find(row => matches(row, filter)) || null)),
    exists: jest.fn(filter => query(() => rows.find(row => matches(row, filter)) ? { _id: true } : null)),
    updateOne: jest.fn((filter, update) => query(() => {
      const row = rows.find(value => matches(value, filter));
      if (row) row.__v += update.$inc.__v;
      return { matchedCount: row ? 1 : 0 };
    })),
    findOneAndUpdate: jest.fn((filter, update) => query(() => {
      const row = rows.find(value => matches(value, filter));
      if (!row) return null;
      Object.assign(row, update.$set || update);
      if (update.$inc) row.__v += update.$inc.__v;
      for (const key of Object.keys(update.$unset || {})) delete row[key];
      return { ...row };
    })),
    db: { transaction: jest.fn(async work => {
      const before = rows.map(row => ({ ...row }));
      try { return await work(session); } catch (error) { rows = before; throw error; }
    }) },
  };
  const service = new RegisterService(model, {} as any, {} as any);
  return { service, model, session, rows: () => rows };
}

describe('Administrative member associations', () => {
  it('assigns a carga and its titular in the same transaction, preserving role and access flags', async () => {
    const { service, model, session } = fixture();
    const result = await service.updateAdminByEmail(' member@test.cl ', { partnerType: TipoSocio.CARGA, titularId, namePlayer: 'Updated' });
    expect(result).toMatchObject({ partnerType: TipoSocio.CARGA, namePlayer: 'Updated', role: 'profesor', statePlayer: false, updatePayment: false });
    expect(result.titularId.toString()).toBe(titularId);
    expect(model.db.transaction).toHaveBeenCalledTimes(1);
    expect(model.updateOne).toHaveBeenCalledWith({ _id: new Types.ObjectId(titularId) }, { $inc: { __v: 1 } }, { session });
    expect(model.findOneAndUpdate).toHaveBeenCalledWith({ _id: new Types.ObjectId(memberId) }, expect.any(Object), { new: true, runValidators: true, session });
  });

  it('normalizes Familiar to Carga only when the admin assigns a titular', async () => {
    const { service } = fixture(TipoSocio.FAMILIAR);
    await expect(service.updateAdminByEmail('member@test.cl', { titularId })).resolves.toMatchObject({ partnerType: TipoSocio.CARGA });
  });

  it('keeps a legacy unassociated familiar unchanged when editing unrelated details', async () => {
    const { service, model } = fixture(TipoSocio.FAMILIAR);
    const result = await service.updateAdminByEmail('member@test.cl', { namePlayer: 'Updated' });
    expect(result.partnerType).toBe(TipoSocio.FAMILIAR);
    expect(result.titularId).toBeUndefined();
    expect(model.db.transaction).not.toHaveBeenCalled();
  });

  it('clears the previous titular when changing a carga into a titular', async () => {
    const { service, rows } = fixture(TipoSocio.CARGA);
    rows()[0].titularId = new Types.ObjectId(titularId);
    const result = await service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.TITULAR, titularId: null });
    expect(result.partnerType).toBe(TipoSocio.TITULAR);
    expect(result.titularId).toBeUndefined();
  });

  it.each([undefined, null, '', 'not-an-id'])('rejects a carga without a valid titular: %s', async value => {
    const { service, model } = fixture();
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.CARGA, titularId: value })).rejects.toBeInstanceOf(BadRequestException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('rejects self-association', async () => {
    const { service } = fixture();
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.CARGA, titularId: memberId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a missing titular', async () => {
    const { service, rows } = fixture(); rows().pop();
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.CARGA, titularId })).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([TipoSocio.CARGA, TipoSocio.FAMILIAR])('does not accept another %s as the titular', async type => {
    const { service, rows } = fixture(); rows()[1].partnerType = type;
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.CARGA, titularId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not demote a titular who still has associated cargas', async () => {
    const { service, rows } = fixture();
    rows().push({ _id: new Types.ObjectId(), titularId: new Types.ObjectId(memberId), partnerType: TipoSocio.CARGA });
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.CARGA, titularId })).rejects.toBeInstanceOf(ConflictException);
    expect(rows()[0].partnerType).toBe(TipoSocio.TITULAR);
  });

  it('rejects an association on a titular', async () => {
    const { service } = fixture();
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.TITULAR, titularId })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an unknown member', async () => {
    const { service } = fixture();
    await expect(service.updateAdminByEmail('missing@test.cl', { partnerType: TipoSocio.CARGA, titularId })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rolls back the titular lock and profile fields if the member write fails', async () => {
    const { service, model, rows } = fixture();
    model.findOneAndUpdate.mockImplementationOnce(() => query(() => { throw new Error('Database write failed'); }));
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.CARGA, titularId, namePlayer: 'Not saved' })).rejects.toThrow('Database write failed');
    expect(rows()[1].__v).toBe(0);
    expect(rows()[0].namePlayer).toBe('Member');
  });

  it('rejects a titular which disappears before it can be locked', async () => {
    const { service, model } = fixture();
    model.updateOne.mockImplementationOnce(() => query(() => ({ matchedCount: 0 })));
    await expect(service.updateAdminByEmail('member@test.cl', { partnerType: TipoSocio.CARGA, titularId })).rejects.toBeInstanceOf(ConflictException);
  });

  it('does not allow assignment through the old public profile endpoint', async () => {
    const { service, model } = fixture();
    await expect(service.updateByEmail('member@test.cl', { titularId } as any)).rejects.toBeInstanceOf(ForbiddenException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does not allow type changes through the old public profile endpoint', async () => {
    const { service } = fixture();
    await expect(service.updateByEmail('member@test.cl', { partnerType: TipoSocio.CARGA })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps an old client sending an unchanged type compatible', async () => {
    const { service } = fixture(TipoSocio.FAMILIAR);
    await expect(service.updateByEmail('member@test.cl', { partnerType: TipoSocio.FAMILIAR, namePlayer: 'Updated' })).resolves.toMatchObject({ partnerType: TipoSocio.FAMILIAR, namePlayer: 'Updated' });
  });

  it.each([{ $set: { titularId } }, { 'titularId.value': titularId }])('rejects operator/dotted-field bypasses: %j', async payload => {
    const { service } = fixture();
    await expect(service.updateByEmail('member@test.cl', payload as any)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the existing photo update endpoint working', async () => {
    const { service } = fixture();
    await expect(service.updateByEmail('member@test.cl', { imageUrlProfile: 'https://image.example/profile.jpg' })).resolves.toMatchObject({ imageUrlProfile: 'https://image.example/profile.jpg' });
  });
});
