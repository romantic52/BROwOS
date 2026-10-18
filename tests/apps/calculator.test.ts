import { describe, expect, it } from 'vitest';
import { evaluateExpression, formatResult } from '../../system-apps/calculator/src/calculate';

describe('safe calculator parser', () => {
  it.each([
    ['2 + 3 * 4', 14],
    ['(2 + 3) * 4', 20],
    ['20 / 5 / 2', 2],
    ['-3 * -(2 + 4)', 18],
    ['0,5 + .25', 0.75],
    ['200 × 10%', 20],
    ['50% + 25%', 0.75],
    ['1e3 ÷ 2', 500],
    ['1--2', 3],
  ])('evaluates %s with arithmetic precedence', (expression, result) =>
    expect(evaluateExpression(expression)).toBe(result),
  );
  it('normalizes floating-point display noise', () =>
    expect(formatResult(evaluateExpression('0.1 + 0.2'))).toBe('0.3'));
  it.each([
    '1/0',
    '(1+2',
    '1+2)',
    '2(3)',
    '1+',
    '.',
    'NaN',
    'Infinity',
    '2**3',
    'Math.random()',
    'globalThis.process.exit()',
    '1;alert(1)',
    '1e309',
    '',
  ])('rejects invalid or executable input %s', (expression) =>
    expect(() => evaluateExpression(expression)).toThrow(),
  );
  it('bounds recursive input', () =>
    expect(() => evaluateExpression('('.repeat(70) + '1' + ')'.repeat(70))).toThrow());
  it('bounds input size', () => expect(() => evaluateExpression('1'.repeat(501))).toThrow());
});
