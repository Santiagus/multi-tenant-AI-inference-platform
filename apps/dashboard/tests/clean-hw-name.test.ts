import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { cleanHardwareName } from '../src/components/finops/formatHwName';
import { formatHwShortName } from '../src/components/finops/FinOpsPricingView';

describe('Hardware Name Cleaning for Visualization', () => {
  it('strips verbose vendor prefixes NVIDIA and NVIDIA RTX cleanly', () => {
    assert.equal(cleanHardwareName('NVIDIA GeForce RTX 5070 Ti'), '5070 Ti');
    assert.equal(cleanHardwareName('NVIDIA GeForce RTX 4090'), '4090');
    assert.equal(cleanHardwareName('NVIDIA GeForce RTX 5090'), '5090');
    assert.equal(cleanHardwareName('NVIDIA H100 SXM5 80GB'), 'H100 SXM5 80GB');
    assert.equal(cleanHardwareName('NVIDIA A100 Tensor Core 80GB'), 'A100 Tensor Core 80GB');
    assert.equal(cleanHardwareName('NVIDIA L4 Tensor Core'), 'L4 Tensor Core');
    assert.equal(cleanHardwareName('NVIDIA L40S'), 'L40S');
    assert.equal(cleanHardwareName('NVIDIA RTX A6000 Ada'), 'A6000 Ada');
    assert.equal(cleanHardwareName('RTX 5070 Ti (16GB)'), '5070 Ti (16GB)');
    assert.equal(cleanHardwareName('AWS Inferentia2'), 'AWS Inferentia2');
  });

  it('preserves formatHwShortName normalization with memory capacity', () => {
    assert.equal(formatHwShortName('NVIDIA GeForce RTX 5070 Ti (16GB)', 16), '5070 Ti (16GB)');
    assert.equal(formatHwShortName('NVIDIA GeForce RTX 4090 (24GB)', 24), '4090 (24GB)');
    assert.equal(formatHwShortName('NVIDIA H100 SXM5 (80GB)', 80), 'H100 SXM5 (80GB)');
  });
});
