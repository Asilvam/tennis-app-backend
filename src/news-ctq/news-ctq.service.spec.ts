import { CronExpression } from '@nestjs/schedule';
import { NewsCTQService } from './news-ctq.service';

describe('NewsCTQService cron configuration', () => {
  const activeServices: NewsCTQService[] = [];

  function createService(config: Record<string, string | boolean>) {
    const jobs = new Map<string, any>();
    const schedulerRegistry = {
      addCronJob: jest.fn((name: string, job: any) => jobs.set(name, job)),
      doesExist: jest.fn((_type: string, name: string) => jobs.has(name)),
      getCronJob: jest.fn((name: string) => jobs.get(name)),
      deleteCronJob: jest.fn((name: string) => jobs.delete(name)),
    };
    const configService = {
      get: jest.fn((key: string, fallback?: unknown) => config[key] ?? fallback),
    };
    const service = new NewsCTQService({} as any, configService as any, schedulerRegistry as any);
    activeServices.push(service);
    return { service, schedulerRegistry, jobs };
  }

  afterEach(() => {
    activeServices.splice(0).forEach((service) => service.onModuleDestroy());
    jest.restoreAllMocks();
  });

  it('does not register the job when NEWS_CTQ_CRON_ENABLED is false', () => {
    const { service, schedulerRegistry } = createService({ NEWS_CTQ_CRON_ENABLED: 'false' });

    service.onModuleInit();

    expect(schedulerRegistry.addCronJob).not.toHaveBeenCalled();
  });

  it('registers and starts the configured schedule when enabled', () => {
    const { service, schedulerRegistry, jobs } = createService({
      NEWS_CTQ_CRON_ENABLED: 'true',
      NEWS_CTQ_CRON_SCHEDULE: '0 15 7 * * *',
    });

    service.onModuleInit();

    expect(schedulerRegistry.addCronJob).toHaveBeenCalledWith('news-ctq-sync', expect.anything());
    expect(jobs.get('news-ctq-sync').running).toBe(true);
  });

  it('keeps the previous 06:00 schedule as the default', () => {
    const { service, jobs } = createService({ NEWS_CTQ_CRON_ENABLED: true });

    service.onModuleInit();

    expect(jobs.get('news-ctq-sync').cronTime.source).toBe(CronExpression.EVERY_DAY_AT_6AM);
  });

  it('rejects an invalid enabled value', () => {
    const { service } = createService({ NEWS_CTQ_CRON_ENABLED: 'sometimes' });
    expect(() => service.onModuleInit()).toThrow('NEWS_CTQ_CRON_ENABLED debe ser true o false');
  });

  it('rejects an invalid cron expression', () => {
    const { service } = createService({
      NEWS_CTQ_CRON_ENABLED: 'true',
      NEWS_CTQ_CRON_SCHEDULE: 'not-a-cron',
    });
    expect(() => service.onModuleInit()).toThrow('NEWS_CTQ_CRON_SCHEDULE inválido');
  });
});
