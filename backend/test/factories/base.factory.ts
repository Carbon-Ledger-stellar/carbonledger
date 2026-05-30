import { v4 as uuidv4 } from 'uuid';

export type FactoryOverride<T> = Partial<T>;

export abstract class BaseFactory<T> {
  protected abstract getDefault(): T;

  build(overrides: FactoryOverride<T> = {}): T {
    return {
      ...this.getDefault(),
      ...overrides,
    };
  }

  buildMany(count: number, overrides: FactoryOverride<T> = {}): T[] {
    return Array.from({ length: count }, () => this.build(overrides));
  }

  protected generateId(): string {
    return uuidv4();
  }

  protected generateDate(startDate?: Date): Date {
    return startDate || new Date();
  }

  protected generateNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
}
