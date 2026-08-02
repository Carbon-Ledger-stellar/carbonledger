import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PrivateCertificateDto {
  retirementId: string;
  scheme: string;
  circuit: string;
  beneficiaryCommitment: string;
  nullifier: string;
  retiredByHash: string;
  proof: unknown;
  publicSignals: string[];
  verifiedOnChain: boolean;
  createdAt: Date;
  note: string;
}

@Injectable()
export class ZkProofService {
  private readonly logger = new Logger(ZkProofService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getProof(retirementId: string): Promise<PrivateCertificateDto> {
    const retirement = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
    });
    if (!retirement) throw new NotFoundException('Retirement not found');

    const stored = await this.prisma.zkRetirementProof.findFirst({
      where: { retirementId: retirement.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!stored) throw new NotFoundException('No ZK proof for this retirement');
    return this.toDto(retirement.retirementId, stored);
  }

  async generateProof(retirementId: string): Promise<PrivateCertificateDto> {
    const retirement = await this.prisma.retirementRecord.findUnique({
      where: { retirementId },
    });
    if (!retirement) throw new NotFoundException('Retirement not found');

    const existing = await this.prisma.zkRetirementProof.findFirst({
      where: { retirementId: retirement.id },
    });
    if (existing) {
      throw new ConflictException(
        'ZK proof already exists for this retirement; use GET to retrieve it',
      );
    }

    const repoRoot = this.resolveRepoRoot();
    const script = path.join(repoRoot, 'scripts', 'generate-retirement-proof.sh');
    if (!fs.existsSync(script)) {
      throw new BadRequestException(
        'Proof CLI missing — ensure scripts/generate-retirement-proof.sh is present',
      );
    }

    const zkey = path.join(
      repoRoot,
      'circuits',
      'retirement_private_cert',
      'artifacts',
      'retirement_private_cert_final.zkey',
    );
    if (!fs.existsSync(zkey)) {
      throw new BadRequestException(
        'Circuit artifacts missing. Run: bash scripts/zk/trusted-setup.sh',
      );
    }

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zk-retire-'));
    const witnessPath = path.join(tmpDir, 'retirement.json');
    const outDir = path.join(tmpDir, 'out');
    fs.mkdirSync(outDir);

    const record = {
      retirementId: retirement.retirementId,
      beneficiary: retirement.beneficiary,
      amount: retirement.amount.toString(),
      projectId: retirement.projectId,
      serialStart: retirement.serialStart,
      serialEnd: retirement.serialEnd,
      retiredBy: retirement.retiredBy,
    };
    fs.writeFileSync(witnessPath, JSON.stringify(record));

    try {
      await this.runProofCli(script, witnessPath, outDir);
      const certPath = path.join(outDir, 'private_certificate.json');
      const publicPath = path.join(outDir, 'public.json');
      const proofPath = path.join(outDir, 'proof.json');
      if (!fs.existsSync(certPath)) {
        throw new BadRequestException('Prover did not produce private_certificate.json');
      }
      const cert = JSON.parse(fs.readFileSync(certPath, 'utf8'));
      const publicSignals: string[] = JSON.parse(fs.readFileSync(publicPath, 'utf8'));
      const proofJson = JSON.parse(fs.readFileSync(proofPath, 'utf8'));

      const stored = await this.prisma.zkRetirementProof.create({
        data: {
          retirementId: retirement.id,
          beneficiaryCommitment: String(cert.publicSignals.beneficiaryCommitment),
          nullifier: String(cert.publicSignals.nullifier),
          retiredByHash: String(cert.publicSignals.retiredByHash),
          proofJson,
          publicSignals,
          verifiedOnChain: false,
        },
      });

      this.logger.log(
        `Stored ZK proof nullifierPrefix=${stored.nullifier.slice(0, 12)} for retirement ${retirementId}`,
      );
      return this.toDto(retirement.retirementId, stored);
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  private toDto(retirementId: string, stored: {
    beneficiaryCommitment: string;
    nullifier: string;
    retiredByHash: string;
    proofJson: unknown;
    publicSignals: unknown;
    verifiedOnChain: boolean;
    createdAt: Date;
  }): PrivateCertificateDto {
    return {
      retirementId,
      scheme: 'groth16-bls12-381',
      circuit: 'retirement_private_cert',
      beneficiaryCommitment: stored.beneficiaryCommitment,
      nullifier: stored.nullifier,
      retiredByHash: stored.retiredByHash,
      proof: stored.proofJson,
      publicSignals: stored.publicSignals as string[],
      verifiedOnChain: stored.verifiedOnChain,
      createdAt: stored.createdAt,
      note:
        'Private certificate: beneficiary name, amount, project, and serials are not revealed. ' +
        'Nullifier prevents duplicate certificates. Dev trusted setup must not be used on mainnet.',
    };
  }

  private resolveRepoRoot(): string {
    const fromEnv = process.env.CARBONLEDGER_ROOT;
    if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
    return path.resolve(__dirname, '..', '..', '..');
  }

  private runProofCli(script: string, witnessPath: string, outDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn('bash', [script, '--witness.json', witnessPath], {
        env: { ...process.env, OUT_DIR: outDir },
        cwd: this.resolveRepoRoot(),
      });
      child.on('error', reject);
      child.on('close', (code) => {
        if (code === 0) resolve();
        else {
          this.logger.error(`Proof CLI failed (code=${code})`);
          reject(
            new BadRequestException(
              `Proof generation failed (exit ${code}). Ensure circom/snarkjs artifacts are built.`,
            ),
          );
        }
      });
    });
  }
}
