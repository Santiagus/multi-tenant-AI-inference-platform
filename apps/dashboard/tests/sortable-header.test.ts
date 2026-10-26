import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { genericSort } from '../src/components/common/SortableHeader.js';

describe('genericSort utility', () => {
  const sampleItems = [
    { id: 'job-3', name: 'Llama 3', count: 42, active: false, date: '2026-10-22T10:00:00Z' },
    { id: 'job-1', name: 'Mistral', count: 10, active: true, date: '2026-10-22T08:00:00Z' },
    { id: 'job-2', name: 'Claude', count: 100, active: true, date: '2026-10-22T12:00:00Z' },
  ];

  it('returns same array if key is null', () => {
    const res = genericSort(sampleItems, null, 'asc');
    assert.deepEqual(res, sampleItems);
  });

  it('sorts numeric fields ascending and descending', () => {
    const asc = genericSort(sampleItems, 'count', 'asc');
    assert.deepEqual(asc.map((i) => i.count), [10, 42, 100]);

    const desc = genericSort(sampleItems, 'count', 'desc');
    assert.deepEqual(desc.map((i) => i.count), [100, 42, 10]);
  });

  it('sorts string fields alphabetically', () => {
    const asc = genericSort(sampleItems, 'name', 'asc');
    assert.deepEqual(asc.map((i) => i.name), ['Claude', 'Llama 3', 'Mistral']);

    const desc = genericSort(sampleItems, 'name', 'desc');
    assert.deepEqual(desc.map((i) => i.name), ['Mistral', 'Llama 3', 'Claude']);
  });

  it('sorts booleans correctly', () => {
    const asc = genericSort(sampleItems, 'active', 'asc');
    assert.deepEqual(asc.map((i) => i.active), [false, true, true]);

    const desc = genericSort(sampleItems, 'active', 'desc');
    assert.deepEqual(desc.map((i) => i.active), [true, true, false]);
  });

  it('sorts ISO date strings chronologically', () => {
    const asc = genericSort(sampleItems, 'date', 'asc');
    assert.deepEqual(asc.map((i) => i.id), ['job-1', 'job-3', 'job-2']);

    const desc = genericSort(sampleItems, 'date', 'desc');
    assert.deepEqual(desc.map((i) => i.id), ['job-2', 'job-3', 'job-1']);
  });

  it('supports custom value extractors for nested or computed properties', () => {
    const complexItems = [
      { id: 'a', usage: { tokens: 500 } },
      { id: 'b', usage: { tokens: 100 } },
      { id: 'c', usage: { tokens: 1000 } },
    ];

    const sorted = genericSort(complexItems, 'tokens', 'desc', (item, key) => {
      if (key === 'tokens') return item.usage.tokens;
      return null;
    });

    assert.deepEqual(sorted.map((i) => i.id), ['c', 'a', 'b']);
  });
});

