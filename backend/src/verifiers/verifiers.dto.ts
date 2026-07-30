import { IsString, IsEmail } from 'class-validator';

export class ApplyVerifierDto {
  @IsString() publicKey: string;
  @IsString() organizationName: string;
  @IsString() accreditationBody: string;
  @IsString() accreditationId: string;
  @IsEmail()  contactEmail: string;
  @IsString() documentsCid: string;  // IPFS CID uploaded by client before calling this endpoint
}

export class ReviewVerifierDto {
  @IsString() adminPublicKey: string;
  @IsString() decision: 'approved' | 'rejected';
  @IsString() rejectionReason?: string;
}
