import { Controller, Get, Post, Body, Param, UseGuards, BadRequestException } from '@nestjs/common';
import { CreditsService } from '../credits/credits.service';
import { AbuseDetectorGuard } from '../security/abuse.guard';
import { Public } from '../auth/decorators';
import { SkipThrottle } from '../throttle';

@Controller('public')
@UseGuards(AbuseDetectorGuard)
export class PublicSerialController {
  constructor(private readonly creditsService: CreditsService) {}

  @Get('serial/:number')
  @Public()
  @SkipThrottle()
  async lookupSerial(@Param('number') serial: string) {
    if (!serial) {
      throw new BadRequestException('Serial number is required');
    }
    return this.creditsService.lookupSerial(serial);
  }

  @Post('serials')
  @Public()
  @SkipThrottle()
  async bulkLookup(@Body('serials') serials: string[]) {
    if (!Array.isArray(serials) || serials.length === 0) {
      throw new BadRequestException('Provide an array of serials');
    }
    if (serials.length > 10) {
      throw new BadRequestException('Max 10 serials per request allowed');
    }
    
    const results = await Promise.allSettled(
      serials.map(serial => this.creditsService.lookupSerial(serial))
    );

    return serials.map((serial, index) => {
      const result = results[index];
      if (result.status === 'fulfilled') {
        return { serial, data: result.value };
      } else {
        return { serial, error: 'Not found' };
      }
    });
  }
}
