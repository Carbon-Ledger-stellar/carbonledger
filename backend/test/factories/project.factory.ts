import { BaseFactory, FactoryOverride } from './base.factory';

export interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  methodology: string;
  status: 'draft' | 'active' | 'completed' | 'cancelled';
  startDate: Date;
  endDate?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export class ProjectFactory extends BaseFactory<Project> {
  protected getDefault(): Project {
    return {
      id: this.generateId(),
      name: `Test Project ${this.generateNumber(1, 999)}`,
      description: 'This is a test project for integration testing',
      location: `Country ${this.generateNumber(1, 50)}`,
      methodology: `Methodology v${this.generateNumber(1, 5)}`,
      status: 'active',
      startDate: this.generateDate(),
      endDate: undefined,
      createdAt: this.generateDate(),
      updatedAt: this.generateDate(),
    };
  }
}

export const createProject = (overrides?: FactoryOverride<Project>) => {
  const factory = new ProjectFactory();
  return factory.build(overrides);
};

export const createProjects = (count: number, overrides?: FactoryOverride<Project>) => {
  const factory = new ProjectFactory();
  return factory.buildMany(count, overrides);
};
