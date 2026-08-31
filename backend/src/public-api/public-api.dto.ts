import { IsEmail, IsString, MinLength } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @MinLength(2)
  organizationName: string;

  @IsEmail()
  contactEmail: string;
}
