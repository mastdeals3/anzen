import {
  formatIndonesianMoneyInput,
  parseIndonesianMoneyInput,
} from '../src/utils/currency.ts';

const validCases = [
  ['55.359.075,50', 55359075.50],
  ['55.359.075', 55359075],
  ['55359075,50', 55359075.50],
  ['55359075', 55359075],
  ['0,50', 0.50],
  ['100,25', 100.25],
  // A trailing comma must remain a valid intermediate typing state.
  ['55.359.075,', 55359075],
];

for (const [input, expected] of validCases) {
  const actual = parseIndonesianMoneyInput(input);
  if (actual !== expected) {
    throw new Error(`${input} parsed as ${actual}; expected ${expected}`);
  }
}

for (const invalid of ['abc', '1,2,3', '1-2']) {
  if (parseIndonesianMoneyInput(invalid) !== null) {
    throw new Error(`Invalid money input was accepted: ${invalid}`);
  }
}

const formatted = formatIndonesianMoneyInput(55359075.50);
if (formatted !== '55.359.075,50') {
  throw new Error(`Unexpected Indonesian display format: ${formatted}`);
}

console.log('Indonesian money-input regression passed.');
