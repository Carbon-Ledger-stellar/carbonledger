import { describe, expect, it } from '@jest/globals';
import { describeSimulationError } from './soroban';

describe('describeSimulationError', () => {
  it('maps contract errors to human-readable messages', () => {
    expect(describeSimulationError('ContractError: 4')).toContain('insufficient credits');
    expect(describeSimulationError('ContractError: 10')).toContain('listing');
  });

  it('falls back to a friendly message for unknown errors', () => {
    expect(describeSimulationError('something unexpected')).toContain('Unable to preview');
  });
});
