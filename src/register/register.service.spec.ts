import { BadRequestException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { RegisterService } from './register.service';

jest.mock('bcryptjs', () => ({ hash: jest.fn() }));

describe('RegisterService', () => {
  const save = jest.fn();
  const registerModel: any = jest.fn();
  registerModel.findOne = jest.fn();
  registerModel.updateOne = jest.fn();
  registerModel.find = jest.fn();
  registerModel.findOneAndUpdate = jest.fn();

  const emailService = {
    sendResetPasswordEmail: jest.fn(),
    sendVerificationEmail: jest.fn(),
  };
  const playerCategoryPointsService = {
    initializePlayerCategories: jest.fn(),
    getPlayerCategories: jest.fn(),
  };
  let service: RegisterService;

  beforeEach(() => {
    jest.clearAllMocks();
    registerModel.mockImplementation((data: any) => ({
      ...data,
      verificationToken: 'verification-token',
      save,
    }));
    service = new RegisterService(registerModel, emailService as any, playerCategoryPointsService as any);
  });

  it('hashes a password with ten salt rounds', async () => {
    (bcrypt.hash as jest.Mock).mockResolvedValue('hashed');
    await expect(service.hashPassword('secret')).resolves.toBe('hashed');
    expect(bcrypt.hash).toHaveBeenCalledWith('secret', 10);
  });

  describe.each([
    ['enablePlayerPayment', true, 'Estado de Pago actualizado con éxito.'],
    ['blockPlayerPayment', false, 'Jugador bloqueado con éxito (pago no actualizado).'],
  ] as const)('%s', (method, updatePayment, message) => {
    it('updates an existing player', async () => {
      registerModel.findOne.mockResolvedValue({ email: 'user@example.com' });
      registerModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await expect(service[method]('user@example.com')).resolves.toEqual({ success: true, message });
      expect(registerModel.updateOne).toHaveBeenCalledWith({ email: 'user@example.com' }, { updatePayment });
    });

    it('rejects a missing player', async () => {
      registerModel.findOne.mockResolvedValue(null);
      await expect(service[method]('missing@example.com')).rejects.toThrow(NotFoundException);
    });

    it('wraps database failures', async () => {
      registerModel.findOne.mockRejectedValue(new Error('Mongo unavailable'));
      await expect(service[method]('user@example.com')).rejects.toThrow(InternalServerErrorException);
    });
  });


  it.each([
    [[{ namePlayer: 'Player' }], true],
    [[], false],
  ])('reports whether a player has a night-light reservation', async (records, expected) => {
    registerModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue(records) });
    await expect(service.getAllNigthsLigths('Player')).resolves.toBe(expected);
    expect(registerModel.find).toHaveBeenCalledWith({ namePlayer: 'Player', isLigthNigth: true });
  });

  it('returns undefined when the night-light lookup fails', async () => {
    registerModel.find.mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('Mongo unavailable')) });
    await expect(service.getAllNigthsLigths('Player')).resolves.toBeUndefined();
  });

  it('returns all players sorted by name', async () => {
    const records = [{ namePlayer: 'A' }];
    const exec = jest.fn().mockResolvedValue(records);
    const sort = jest.fn().mockReturnValue({ exec });
    registerModel.find.mockReturnValue({ sort });
    await expect(service.findAll()).resolves.toBe(records);
    expect(sort).toHaveBeenCalledWith({ namePlayer: 1 });
  });

  it('wraps failures while listing players', async () => {
    registerModel.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({ exec: jest.fn().mockRejectedValue(new Error('Mongo unavailable')) }),
    });
    await expect(service.findAll()).rejects.toThrow(InternalServerErrorException);
  });

  const createDto: any = {
    namePlayer: 'Player',
    email: 'user@example.com',
    cellular: '123456789',
    pwd: 'secret',
    partnerType: 'titular',
    urlEmail: 'http://localhost:3000',
    categories: [{ category: 'A', matchTypes: ['singles'] }],
  };

  it('rejects a duplicate email address', async () => {
    registerModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue({ email: createDto.email }) });
    await expect(service.create(createDto)).rejects.toThrow(new BadRequestException('User mail already exists'));
  });

  it('rejects a duplicate phone number', async () => {
    registerModel.findOne
      .mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) })
      .mockResolvedValueOnce({ cellular: createDto.cellular });
    await expect(service.create(createDto)).rejects.toThrow(new BadRequestException('Phone number already exists.'));
  });

  it('creates a player, initializes categories, and sends verification', async () => {
    registerModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }).mockResolvedValueOnce(null);
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
    const saved = { id: 'register-1' };
    save.mockResolvedValue(saved);

    await expect(service.create(createDto)).resolves.toBe(saved);
    expect(registerModel).toHaveBeenCalledWith(expect.objectContaining({ pwd: 'hashed', categories: undefined }));
    expect(playerCategoryPointsService.initializePlayerCategories).toHaveBeenCalledWith(
      createDto.email,
      createDto.categories,
    );
    expect(emailService.sendVerificationEmail).toHaveBeenCalledWith(
      createDto.email,
      'http://localhost:3000/verify-email?token=verification-token',
    );
  });

  it('keeps the registration when category initialization fails', async () => {
    registerModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }).mockResolvedValueOnce(null);
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
    save.mockResolvedValue({ id: 'register-1' });
    playerCategoryPointsService.initializePlayerCategories.mockRejectedValue(new Error('categories unavailable'));

    await expect(service.create(createDto)).resolves.toEqual({ id: 'register-1' });
    expect(emailService.sendVerificationEmail).toHaveBeenCalledTimes(1);
  });

  it('supports creating a player without categories or a saved response', async () => {
    registerModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }).mockResolvedValueOnce(null);
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
    save.mockResolvedValue(undefined);

    await expect(service.create({ ...createDto, categories: undefined })).resolves.toBeUndefined();
    expect(playerCategoryPointsService.initializePlayerCategories).not.toHaveBeenCalled();
    expect(emailService.sendVerificationEmail).not.toHaveBeenCalled();
  });

  it('does not accept a titular association through public registration', async () => {
    registerModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }).mockResolvedValueOnce(null);
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
    save.mockResolvedValue({ id: 'register-1' });
    await service.create({ ...createDto, categories: undefined, titularId: '000000000000000000000002' });
    expect(registerModel.mock.calls[0][0]).not.toHaveProperty('titularId');
  });

  it('assigns server-owned signup permissions and ignores privileged fields even in direct service calls', async () => {
    registerModel.findOne.mockReturnValueOnce({ exec: jest.fn().mockResolvedValue(null) }).mockResolvedValueOnce(null);
    jest.spyOn(service, 'hashPassword').mockResolvedValue('hashed');
    save.mockResolvedValue({ id: 'register-1' });
    await service.create({ ...createDto, categories: undefined, role: 'admin', statePlayer: true, updatePayment: false, emailVerified: true,
      verificationToken: 'chosen-token', estadoPago: 'PENDIENTE', isLigthNigth: true, imageUrlProfile: 'https://image.example/forged.jpg' });
    const persisted = registerModel.mock.calls[0][0];
    expect(persisted).toMatchObject({ role: 'user', statePlayer: false, updatePayment: true, emailVerified: false, pwd: 'hashed' });
    for (const field of ['verificationToken', 'estadoPago', 'isLigthNigth', 'imageUrlProfile']) expect(persisted).not.toHaveProperty(field);
  });

  it.each(['role', 'statePlayer', 'updatePayment', 'emailVerified', 'verificationToken', 'email', 'pwd', 'partnerType', 'titularId', '$set', 'role.value'])('rejects %s in the profile service before writing', async field => {
    await expect(service.updateProfileByEmail('user@example.com', { [field]: 'forged' } as any)).rejects.toThrow('El perfil no permite');
    expect(registerModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('updates only allowed profile fields with validators and a server-built set operation', async () => {
    const updated = { email: 'user@example.com', imageUrlProfile: 'https://images.example/profile.jpg' };
    registerModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) });
    await expect(service.updateProfileByEmail(updated.email, { imageUrlProfile: updated.imageUrlProfile, namePlayer: undefined })).resolves.toBe(updated);
    expect(registerModel.findOneAndUpdate).toHaveBeenCalledWith({ email: updated.email }, { $set: { imageUrlProfile: updated.imageUrlProfile } }, { new: true, runValidators: true });
  });

  it('rejects a profile update for a missing member', async () => {
    registerModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.updateProfileByEmail('missing@example.com', { namePlayer: 'Updated' })).rejects.toThrow(NotFoundException);
  });

  it('returns the placeholder removal result', async () => {
    await expect(service.remove(12)).resolves.toBe('This action removes a #12 register');
  });

  it('finds a player and maps category records', async () => {
    registerModel.findOne.mockReturnValue({
      exec: jest.fn().mockResolvedValue({ email: 'user@example.com', namePlayer: 'Player', cellular: '123' }),
    });
    playerCategoryPointsService.getPlayerCategories.mockResolvedValue([
      { category: 'A', points: 10, isActive: true, ignored: true },
    ]);

    await expect(service.findOneEmail('Player')).resolves.toEqual({
      email: 'user@example.com',
      name: 'Player',
      cellular: '123',
      categories: [{ category: 'A', points: 10, isActive: true }],
    });
  });

  it('wraps a missing player error from findOneEmail', async () => {
    registerModel.findOne.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.findOneEmail('Missing')).rejects.toThrow(
      new BadRequestException('Error finding register: Name Player Register not found'),
    );
  });

  it('lists active and paid player names', async () => {
    const exec = jest.fn().mockResolvedValue([{ namePlayer: 'A' }, { namePlayer: 'B' }]);
    const select = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ select });
    registerModel.find.mockReturnValue({ sort });

    await expect(service.findAllNamePlayers()).resolves.toEqual(['A', 'B']);
    expect(registerModel.find).toHaveBeenCalledWith({ statePlayer: true, updatePayment: true });
    expect(sort).toHaveBeenCalledWith({ namePlayer: 'asc' });
    expect(select).toHaveBeenCalledWith('namePlayer');
  });

  it('validates a normalized player email with selected fields', async () => {
    const exec = jest.fn().mockResolvedValue({ email: 'user@example.com' });
    const select = jest.fn().mockReturnValue({ exec });
    registerModel.findOne.mockReturnValue({ select });

    await expect(service.validatePlayerEmail('USER@EXAMPLE.COM')).resolves.toEqual({ email: 'user@example.com' });
    expect(registerModel.findOne).toHaveBeenCalledWith({ email: 'user@example.com' });
  });

  it('delegates direct lookup and update methods', async () => {
    const update = { namePlayer: 'Updated' } as any;
    registerModel.findOneAndUpdate.mockResolvedValueOnce('updated');
    await expect(service.findOneAndUpdate('Player', update)).resolves.toBe('updated');
    expect(registerModel.findOneAndUpdate).toHaveBeenCalledWith({ namePlayer: 'Player' }, update);

    registerModel.findOne.mockReturnValueOnce('by-email').mockReturnValueOnce('by-token');
    expect(service.findOneByEmail('user@example.com')).toBe('by-email');
    await expect(service.findByVerificationToken('token')).resolves.toBe('by-token');
  });

  it('updates a player by email', async () => {
    const updated = { email: 'user@example.com', namePlayer: 'Updated' };
    registerModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(updated) });
    await expect(service.updateByEmail('user@example.com', { namePlayer: 'Updated' })).resolves.toBe(updated);
  });

  it('rejects an update for an unknown email', async () => {
    registerModel.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });
    await expect(service.updateByEmail('missing@example.com', {})).rejects.toThrow(NotFoundException);
  });
});
