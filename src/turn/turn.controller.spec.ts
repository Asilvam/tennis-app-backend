import { Test, TestingModule } from '@nestjs/testing';
import { TurnController } from './turn.controller';
import { TurnService } from './turn.service';

describe('TurnController', () => {
  let controller: TurnController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [TurnController],
      providers: [TurnService],
    }).compile();

    controller = module.get<TurnController>(TurnController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
