import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as Parser from 'rss-parser';
import { NewsCTQ, NewsCTQDocument } from './entities/news-ctq.entity';

@Injectable()
export class NewsCTQService {
  private readonly logger = new Logger(NewsCTQService.name);
  private parser: Parser;

  constructor(@InjectModel(NewsCTQ.name) private newsModel: Model<NewsCTQDocument>) {
    this.parser = new Parser();
  }

  @Cron(CronExpression.EVERY_DAY_AT_6PM) // Ajustado para revisar cambios frecuentemente
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
   * Query acepta `from` y/o `to` en formato ISO (YYYY-MM-DD o full ISO). Si ninguno se entrega, devuelve todas (limit 100).
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
