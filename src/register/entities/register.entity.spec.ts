import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { Register, RegisterDocument, RegisterSchema } from './register.entity';
import * as mongoose from 'mongoose';

describe('Register Entity & Schema', () => {
  let RegisterModel: any;

  beforeAll(async () => {
    // Compilamos el modelo a partir del schema para poder probar sus validaciones
    RegisterModel = mongoose.model('RegisterSpec', RegisterSchema);
  });

  afterAll(() => {
    mongoose.deleteModel('RegisterSpec');
  });

  it('debería permitir el rol "profesor"', async () => {
    const user = new RegisterModel({
      namePlayer: 'Profesor Test',
      email: 'profe@test.com',
      cellular: '123456789',
      pwd: 'hashedpassword',
      role: 'profesor',
    });

    const error = user.validateSync();
    expect(error).toBeUndefined(); // No debería arrojar error de validación
    expect(user.role).toBe('profesor');
  });

  it('debería permitir el rol "admin"', async () => {
    const user = new RegisterModel({
      namePlayer: 'Admin Test',
      email: 'admin@test.com',
      cellular: '123456789',
      pwd: 'hashedpassword',
      role: 'admin',
    });

    const error = user.validateSync();
    expect(error).toBeUndefined();
  });

  it('debería arrojar error si el rol no es válido', async () => {
    const user = new RegisterModel({
      namePlayer: 'Inválido Test',
      email: 'invalido@test.com',
      cellular: '123456789',
      pwd: 'hashedpassword',
      role: 'superadmin', // Rol que no existe en el enum
    });

    const error = user.validateSync();
    expect(error).toBeDefined();
    expect(error.errors['role']).toBeDefined();
    expect(error.errors['role'].message).toContain('is not a valid enum value');
  });

  it('debería asignar el rol "user" por defecto si no se especifica', async () => {
    const user = new RegisterModel({
      namePlayer: 'Default Test',
      email: 'default@test.com',
      cellular: '123456789',
      pwd: 'hashedpassword',
    });

    // Mongoose asigna defaults al validar
    const error = user.validateSync();
    expect(error).toBeUndefined();
    expect(user.role).toBe('user');
  });
});
