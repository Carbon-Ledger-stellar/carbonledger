import { DataSource } from 'typeorm';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';

export class DatabaseTestHelper {
  private dataSource: DataSource;
  private module: TestingModule;

  async init() {
    this.module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    this.dataSource = this.module.get(DataSource);
    await this.dataSource.synchronize(true);
  }

  async cleanup() {
    const entities = this.dataSource.entityMetadatas;
    for (const entity of entities) {
      const repository = this.dataSource.getRepository(entity.name);
      await repository.clear();
    }
  }

  async close() {
    if (this.dataSource) {
      await this.dataSource.destroy();
    }
    if (this.module) {
      await this.module.close();
    }
  }

  async runInTransaction<T>(callback: () => Promise<T>): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const result = await callback();
      await queryRunner.rollbackTransaction();
      return result;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
