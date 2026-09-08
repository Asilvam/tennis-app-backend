import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CronExpression, SchedulerRegistry } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as Parser from 'rss-parser';
import { CronJob } from 'cron';
import { NewsCTQ, NewsCTQDocument } from './entities/news-ctq.entity';

@Injectable()
export class NewsCTQService implements OnModuleInit, OnModuleDestroy {
  private readonly cronJobName = 'news-ctq-sync';
  private readonly logger = new Logger(NewsCTQService.name);
  private parser: Parser;

  constructor(
    @InjectModel(NewsCTQ.name) private newsModel: Model<NewsCTQDocument>,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.parser = new Parser();
  }

  onModuleInit(): void {
    if (!this.isCronEnabled()) {
      this.logger.log('NewsCTQ cron deshabilitado por NEWS_CTQ_CRON_ENABLED.');
      return;
    }

    const schedule = this.configService.get<string>('NEWS_CTQ_CRON_SCHEDULE', CronExpression.EVERY_DAY_AT_6AM);
    let job: CronJob;
    try {
      job = CronJob.from({
        cronTime: schedule,
        onTick: () => void this.syncTennisNews(),
        start: false,
        timeZone: 'America/Santiago',
      });
    } catch (error) {
      throw new Error(`NEWS_CTQ_CRON_SCHEDULE inválido: ${this.errorMessage(error)}`);
    }

    this.schedulerRegistry.addCronJob(this.cronJobName, job);
    job.start();
    this.logger.log(`NewsCTQ cron habilitado con expresión: ${schedule}`);
  }

  onModuleDestroy(): void {
    if (this.schedulerRegistry.doesExist('cron', this.cronJobName)) {
      this.schedulerRegistry.getCronJob(this.cronJobName).stop();
      this.schedulerRegistry.deleteCronJob(this.cronJobName);
    }
  }

  async syncTennisNews() {
    this.logger.log('Iniciando sincronización de NewsCTQ...');

    try {
      const feed = await this.parser.parseURL('https://www.puntodebreak.com/rss.xml');

      const newsToInsert = [];

      for (const item of feed.items) {
        const title = item.title || '';
        const summary = item.contentSnippet || item.content || '';

        // Verificamos si la noticia menciona el club o la zona local
        const contentForAnalysis = `${title} ${summary}`.toLowerCase();
        const isLocal = contentForAnalysis.includes('quintero');

        const newsData = {
          titulo: title,
          url: item.link || '',
          resumen: summary,
          es_local: isLocal,
          fecha: item.pubDate ? new Date(item.pubDate) : new Date(),
          fuente: isLocal ? 'Club Tenis Quintero' : 'ATP Tour',
        };

        // Evitamos duplicados por URL
        const exists = await this.newsModel.exists({ url: newsData.url });

        if (!exists) {
          newsToInsert.push(newsData);
        }
      }

      if (newsToInsert.length > 0) {
        await this.newsModel.insertMany(newsToInsert);
        this.logger.log(`Se han guardado ${newsToInsert.length} nuevas entradas en NewsCTQ.`);
      }
    } catch (error) {
      this.logger.error('Error al obtener noticias del feed ATP:', error);
    }
  }

  private isCronEnabled(): boolean {
    const rawValue = this.configService.get<string | boolean>('NEWS_CTQ_CRON_ENABLED', true);
    if (typeof rawValue === 'boolean') {
      return rawValue;
    }

    const normalized = rawValue.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no', 'off'].includes(normalized)) {
      return false;
    }
    throw new Error('NEWS_CTQ_CRON_ENABLED debe ser true o false');
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  /**
   * Retorna las noticias con el formato JSON solicitado
   */
  async getFormattedNews() {
    const data = await this.newsModel.find().sort({ fecha: -1 }).limit(50).exec();

    return {
      noticias: data.map((n) => ({
        titulo: n.titulo,
        url: n.url,
        resumen: n.resumen,
        es_local: n.es_local,
        fecha: n.fecha.toISOString(),
        fuente: n.fuente,
      })),
    };
  }

  /**
   * Retorna noticias filtradas por rango de fechas.
   * Query acepta `from` y/o `to` en formato ISO (YYYY-MM-DD o full ISO).
   * Si ninguno se entrega, devuelve todas (limit 100).
   */
  async getNewsByDate(from?: string, to?: string) {
    const query: any = {};

    if (from || to) {
      query.fecha = {};
      if (from) {
        const fromDate = new Date(from);
        if (!isNaN(fromDate.getTime())) {
          query.fecha.$gte = fromDate;
        }
      }
      if (to) {
        const toDate = new Date(to);
        if (!isNaN(toDate.getTime())) {
          // include end of day when only date string provided
          if (to.length === 10) {
            toDate.setHours(23, 59, 59, 999);
          }
          query.fecha.$lte = toDate;
        }
      }
    }

    const data = await this.newsModel.find(query).sort({ fecha: -1 }).limit(100).exec();

    return {
      noticias: data.map((n) => ({
        titulo: n.titulo,
        url: n.url,
        resumen: n.resumen,
        es_local: n.es_local,
        fecha: n.fecha.toISOString(),
        fuente: n.fuente,
      })),
    };
  }
}
