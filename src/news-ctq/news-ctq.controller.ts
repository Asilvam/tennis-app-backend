import { Controller, Get, Query, Logger } from '@nestjs/common';
import { NewsCTQService } from './news-ctq.service';

@Controller('news-ctq')
export class NewsCTQController {
  private readonly logger = new Logger(NewsCTQController.name);

  constructor(private readonly newsService: NewsCTQService) {}

  /**
   * GET /news-ctq?from=YYYY-MM-DD&to=YYYY-MM-DD
   * - Si no se entregan `from`/`to`, devuelve el listado formateado por defecto (últimas 50).
   */
  @Get()
  async getNewsByDate(@Query('from') from?: string, @Query('to') to?: string) {
    this.logger.log(`GET /news-ctq?from=${from || ''}&to=${to || ''}`);

    if (!from && !to) {
      return this.newsService.getFormattedNews();
    }

    return this.newsService.getNewsByDate(from, to);
  }
}

