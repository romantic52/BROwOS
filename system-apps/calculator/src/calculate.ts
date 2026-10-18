/** A small arithmetic parser. Expressions never execute JavaScript. */
type Token = { kind: 'number'; value: number } | { kind: 'operator'; value: string };

export function evaluateExpression(source: string): number {
  if (source.length > 500) throw new Error('Выражение слишком длинное');
  const input = source.replaceAll(',', '.').replaceAll('×', '*').replaceAll('÷', '/');
  const tokens: Token[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const character = input[cursor]!;
    if (/\s/.test(character)) {
      cursor += 1;
      continue;
    }
    const number = input.slice(cursor).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new Error('Число слишком велико');
      tokens.push({ kind: 'number', value });
      cursor += number[0].length;
      continue;
    }
    if ('+-*/()%'.includes(character)) {
      tokens.push({ kind: 'operator', value: character });
      cursor += 1;
      continue;
    }
    throw new Error(`Недопустимый символ: ${character}`);
  }
  if (tokens.length === 0) throw new Error('Введите выражение');

  let position = 0;
  function consume(operator: string): boolean {
    const token = tokens[position];
    if (token?.kind !== 'operator' || token.value !== operator) return false;
    position += 1;
    return true;
  }
  function checked(value: number): number {
    if (!Number.isFinite(value)) throw new Error('Результат слишком велик');
    return value;
  }
  function primary(depth: number): number {
    if (depth > 64) throw new Error('Слишком много вложенных скобок');
    if (consume('+')) return primary(depth + 1);
    if (consume('-')) return -primary(depth + 1);
    let value: number;
    if (consume('(')) {
      value = sum(depth + 1);
      if (!consume(')')) throw new Error('Не закрыта скобка');
    } else {
      const token = tokens[position++];
      if (token?.kind !== 'number') throw new Error('Ожидается число');
      value = token.value;
    }
    while (consume('%')) value /= 100;
    return value;
  }
  function product(depth: number): number {
    let value = primary(depth);
    while (true) {
      if (consume('*')) value = checked(value * primary(depth));
      else if (consume('/')) {
        const divisor = primary(depth);
        if (divisor === 0) throw new Error('Деление на ноль невозможно');
        value = checked(value / divisor);
      } else return value;
    }
  }
  function sum(depth: number): number {
    let value = product(depth);
    while (true) {
      if (consume('+')) value = checked(value + product(depth));
      else if (consume('-')) value = checked(value - product(depth));
      else return value;
    }
  }

  const result = checked(sum(0));
  if (position !== tokens.length) throw new Error('Проверьте операторы и скобки');
  return Object.is(result, -0) ? 0 : result;
}

export function formatResult(value: number): string {
  // Hide binary floating-point noise while retaining 14 significant digits.
  return Number(value.toPrecision(14)).toString();
}
