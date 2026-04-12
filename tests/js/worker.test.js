import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('enhanced-pricing.js', () => {
  const content = readFileSync(join(__dirname, '../../src/enhanced-pricing.js'), 'utf8');

  it('should contain ENHANCED_PRICING object', () => {
    expect(content).toContain('ENHANCED_PRICING');
  });

  it('should have detectVariant function', () => {
    expect(content).toContain('detectVariant');
  });

  it('should have specialVariants with known refs', () => {
    expect(content).toContain('228238');
    expect(content).toContain('126519LN');
  });

  it('should have marketMultiplier values', () => {
    expect(content).toContain('marketMultiplier');
  });
});

describe('worker.js', () => {
  const content = readFileSync(join(__dirname, '../../src/worker.js'), 'utf8');

  it('should export default fetch handler', () => {
    expect(content).toContain('export default');
    expect(content).toContain('async fetch');
  });

  it('should handle CORS', () => {
    expect(content).toContain('Access-Control-Allow-Origin');
  });

  it('should serve API routes', () => {
    expect(content).toContain('/api/');
  });
});
