import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { KeyRotationService, OracleRotationRequest, AdminRotationRequest, JWTRotationRequest } from './key-rotation.service';
import { IsString, IsOptional, IsBoolean, IsNumber, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

class OracleRotationDto implements OracleRotationRequest {
  @IsString()
  newOraclePublicKey: string;

  @IsString()
  newOracleSecretKey: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;
}

class AdminRotationDto implements AdminRotationRequest {
  @IsString()
  newAdminPublicKey: string;

  @IsString()
  newAdminSecretKey: string;

  @IsString()
  reason: string;

  @IsBoolean()
  multiSigRequired: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(168) // Max 1 week
  @Type(() => Number)
  timeLockHours?: number;
}

class JWTRotationDto implements JWTRotationRequest {
  @IsString()
  newJWTSecret: string;

  @IsString()
  reason: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(168) // Max 1 week
  @Type(() => Number)
  transitionPeriodHours?: number;
}

@Controller('key-rotation')
@UseGuards(AuthGuard('jwt'))
export class KeyRotationController {
  constructor(private readonly keyRotationService: KeyRotationService) {}

  @Post('oracle')
  async initiateOracleRotation(@Body() dto: OracleRotationDto) {
    const request: OracleRotationRequest = {
      ...dto,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : undefined,
    };
    return this.keyRotationService.initiateOracleRotation(request);
  }

  @Post('admin')
  async initiateAdminRotation(@Body() dto: AdminRotationDto) {
    return this.keyRotationService.initiateAdminRotation(dto);
  }

  @Post('jwt')
  async initiateJWTRotation(@Body() dto: JWTRotationDto) {
    return this.keyRotationService.initiateJWTRotation(dto);
  }

  @Get(':id')
  async getRotationStatus(@Param('id') id: string) {
    return this.keyRotationService.getRotationStatus(id);
  }

  @Get()
  async getAllRotations() {
    return this.keyRotationService.getAllRotations();
  }
}
