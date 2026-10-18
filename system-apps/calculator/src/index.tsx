import { useState, type KeyboardEvent } from 'react';
import type { AppProps } from '@browos/sdk';
import { evaluateExpression, formatResult } from './calculate';
import './apps.css';

const keys = [
  '%',
  'CE',
  'C',
  '⌫',
  '(',
  ')',
  '±',
  '÷',
  '7',
  '8',
  '9',
  '×',
  '4',
  '5',
  '6',
  '−',
  '1',
  '2',
  '3',
  '+',
  '0',
  '.',
  '=',
];

export function CalculatorApp(_props: AppProps) {
  const [expression, setExpression] = useState('');
  const [error, setError] = useState('');
  const [calculated, setCalculated] = useState(false);
  const [history, setHistory] = useState<{ expression: string; result: string }[]>([]);

  function calculate() {
    try {
      const result = formatResult(evaluateExpression(expression));
      setHistory((items) => [{ expression, result }, ...items].slice(0, 8));
      setExpression(result);
      setCalculated(true);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка вычисления');
    }
  }
  function press(key: string) {
    setError('');
    if (key === '=') return calculate();
    if (key === 'C') {
      setExpression('');
      setCalculated(false);
      return;
    }
    if (key === 'CE')
      setExpression((value) => value.replace(/(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?%?$/, ''));
    else if (key === '⌫') setExpression((value) => value.slice(0, -1));
    else if (key === '±')
      setExpression((value) =>
        value.startsWith('-(') && value.endsWith(')') ? value.slice(2, -1) : `-(${value || '0'})`,
      );
    else
      setExpression(
        (value) => `${calculated && /[\d.(]/.test(key) ? '' : value}${key === '−' ? '-' : key}`,
      );
    setCalculated(false);
  }
  function keyboard(event: KeyboardEvent<HTMLElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === 'Enter' || event.key === '=') {
      event.preventDefault();
      calculate();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      press('C');
    } else if (!(event.target instanceof HTMLInputElement)) {
      if (/^[0-9.+\-*/()%]$/.test(event.key)) {
        event.preventDefault();
        press(event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        press('⌫');
      }
    }
  }

  return (
    <section
      className="browos-calculator"
      onKeyDown={keyboard}
      aria-label="Калькулятор"
      tabIndex={0}
    >
      <header className="browos-calculator-heading">
        Обычный <span>Арифметика со скобками</span>
      </header>
      <div className="browos-calculator-display">
        <label className="browos-calculator-label" htmlFor={`expression-${_props.windowId}`}>
          Выражение
        </label>
        <input
          id={`expression-${_props.windowId}`}
          autoComplete="off"
          spellCheck={false}
          inputMode="decimal"
          value={expression}
          placeholder="0"
          aria-invalid={Boolean(error)}
          onChange={(event) => {
            setExpression(event.target.value);
            setCalculated(false);
            setError('');
          }}
        />
        <div className="browos-calculator-error" role="status">
          {error || 'Процент: 25% = 0.25 · Enter — вычислить'}
        </div>
      </div>
      <div className="browos-calculator-keys">
        {keys.map((key) => (
          <button
            type="button"
            key={key}
            className={`${/\d/.test(key) ? 'number' : ''} ${key === '=' ? 'equals' : ''} ${key === '0' ? 'zero' : ''}`}
            onClick={() => press(key)}
            aria-label={
              key === '⌫'
                ? 'Удалить последний символ'
                : key === '='
                  ? 'Вычислить'
                  : key === 'C'
                    ? 'Очистить всё'
                    : key === 'CE'
                      ? 'Очистить число'
                      : key === '±'
                        ? 'Сменить знак'
                        : key
            }
          >
            {key}
          </button>
        ))}
      </div>
      {history.length > 0 && (
        <div className="browos-calculator-history" aria-label="История вычислений">
          <div className="browos-calculator-history-title">
            История{' '}
            <button type="button" onClick={() => setHistory([])}>
              Очистить
            </button>
          </div>
          {history.map((item, index) => (
            <button
              type="button"
              key={`${index}-${item.expression}`}
              onClick={() => {
                setExpression(item.result);
                setCalculated(true);
                setError('');
              }}
            >
              <span>{item.expression} =</span>
              <strong>{item.result}</strong>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
