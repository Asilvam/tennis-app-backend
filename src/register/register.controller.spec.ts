import { RegisterController } from './register.controller';

describe('RegisterController', () => {
  const registerService = {
    findAll: jest.fn(),
    getAllNigthsLigths: jest.fn(),
    findOneByEmail: jest.fn(),
    remove: jest.fn(),
    create: jest.fn(),
    resetPassword: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findAllNamePlayers: jest.fn(),
    updateByEmail: jest.fn(),
    enablePlayerPayment: jest.fn(),
    blockPlayerPayment: jest.fn(),
  };
  const cloudinaryService = { uploadImageBuffer: jest.fn() };
  let controller: RegisterController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new RegisterController(registerService as any, cloudinaryService as any);
  });

  it('delegates register queries and mutations', async () => {
    registerService.findAll.mockReturnValue('all');
    registerService.getAllNigthsLigths.mockReturnValue('lights');
    registerService.findOneByEmail.mockReturnValue('profile');
    registerService.remove.mockReturnValue('removed');
    registerService.create.mockReturnValue('created');
    registerService.resetPassword.mockReturnValue('reset');
    registerService.findAllNamePlayers.mockReturnValue('names');
    registerService.updateByEmail.mockReturnValue('updated');
    registerService.enablePlayerPayment.mockResolvedValue({ success: true });
    registerService.blockPlayerPayment.mockResolvedValue({ success: true });
    const createDto = { email: 'user@example.com' } as any;
    const updateDto = { namePlayer: 'Updated' } as any;

    expect(controller.findAll()).toBe('all');
    expect(controller.findIfHasReserveNigthLigth('Player')).toBe('lights');
    expect(controller.findOne('user@example.com')).toBe('profile');
    expect(controller.remove('7')).toBe('removed');
    expect(controller.register(createDto)).toBe('created');
    await expect(controller.resetPassword({ email: 'user@example.com' })).resolves.toBe('reset');
    expect(controller.findAllNAmes()).toBe('names');
    expect(controller.update('user@example.com', updateDto)).toBe('updated');
    await expect(controller.enablePayment('user@example.com')).resolves.toEqual({ success: true });
    await expect(controller.blockPayment('user@example.com')).resolves.toEqual({ success: true });
    expect(registerService.remove).toHaveBeenCalledWith(7);
  });

  it('updates night-light state for every supplied player', () => {
    expect(controller.updateLightNigths([{ namePlayer: 'A' }, { namePlayer: 'B' }])).toBeUndefined();
    expect(registerService.findOneAndUpdate).toHaveBeenNthCalledWith(1, 'A', { isLigthNigth: true });
    expect(registerService.findOneAndUpdate).toHaveBeenNthCalledWith(2, 'B', { isLigthNigth: true });
  });

  it('uploads a profile image buffer', async () => {
    const file = { buffer: Buffer.from('image') } as Express.Multer.File;
    cloudinaryService.uploadImageBuffer.mockResolvedValue({ secure_url: 'https://images.example/profile.jpg' });
    await expect(controller.uploadProfileImage(file)).resolves.toEqual({
      imageUrl: 'https://images.example/profile.jpg',
    });
    expect(cloudinaryService.uploadImageBuffer).toHaveBeenCalledWith(file.buffer);
  });

  it('rejects an absent profile image', async () => {
    await expect(controller.uploadProfileImage(undefined as any)).rejects.toThrow('No file uploaded');
  });

  it('wraps profile image upload failures', async () => {
    const file = { buffer: Buffer.from('image') } as Express.Multer.File;
    cloudinaryService.uploadImageBuffer.mockRejectedValue(new Error('Cloudinary unavailable'));
    await expect(controller.uploadProfileImage(file)).rejects.toThrow(
      'Failed to upload image to Cloudinary: Cloudinary unavailable',
    );
  });
});
