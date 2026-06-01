import { IsString, IsEthereumAddress, IsOptional, Length } from 'class-validator';

export class VerifierWhitelistDto {
  @IsString() @Length(56, 56) address: string; // Stellar public key (G...)
}

export class UpdateTreasuryDto {
  @IsString() @Length(56, 56) address: string;
}
