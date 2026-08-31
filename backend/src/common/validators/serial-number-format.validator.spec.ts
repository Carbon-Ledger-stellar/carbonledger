import { IsValidSerialConstraint } from './serial-number.validator';

describe('IsValidSerialConstraint', () => {
  const validator = new IsValidSerialConstraint();

  describe('valid serial numbers', () => {
    it.each([
      '0',
      '1',
      '9',
      '10',
      '1234567890',
      '9007199254740991',
    ])('accepts %s', (serial) => {
      expect(validator.validate(serial)).toBe(true);
    });
  });

  describe('invalid serial numbers', () => {
    it.each([
      '',
      ' ',
      '00',
      '01',
      '000123',
      '-1',
      '+1',
      '1.0',
      '1e3',
      'abc',
      '１２３',
      '١٢٣',
      '9007199254740992',
      '12345678901234567',
      1,
      null,
      undefined,
    ])('rejects %p', (serial) => {
      expect(validator.validate(serial)).toBe(false);
    });
  });
});