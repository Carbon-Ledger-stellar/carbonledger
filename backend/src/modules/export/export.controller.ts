import { Controller, Get, Header, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ExportService } from './export.service';

@Controller('export')
@UseGuards(AuthGuard('jwt'))
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Get('csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportCsv(@Req() req: any, @Res() res: Response): Promise<void> {
    const accountId: string = req.user.accountId;

    res.setHeader('Content-Disposition', 'attachment; filename="export.csv"');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');

    const stream = this.exportService.streamCsv(accountId);

    stream.on('error', (err: Error) => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Export failed' });
      } else {
        res.destroy(err);
      }
    });

    res.on('close', () => {
      if (!stream.destroyed) {
        stream.destroy();
      }
    });

    stream.pipe(res);
  }
}
