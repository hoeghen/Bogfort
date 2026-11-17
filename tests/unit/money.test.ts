import { describe, expect, it } from 'vitest';
import { formatAmount, parseAmount } from '../../src/shared/money';

describe('parseAmount', () => {
  it.each([
    ['1.234,50', 123450],
    ['1234,5', 123450],
    ['12', 1200],
    ['12,05', 1205],
    ['12.50', 1250],
    ['1.000', 100000],
    ['1.000.000,00', 100000000],
    [' 99 kr. ', 9900],
    ['0,01', 1],
  ])('%s → %d øre', (input, ore) => {
    expect(parseAmount(input)).toBe(ore);
  });

  it.each(['', 'abc', '0', '0,00', '-5', '1,234', '12,345', '1.2.3'])('rejects %j', (input) => {
    expect(parseAmount(input)).toBeNull();
  });
});

describe('formatAmount', () => {
  it('formats the Danish way', () => {
    expect(formatAmount(123450)).toBe('1.234,50');
    expect(formatAmount(5)).toBe('0,05');
  });
});
