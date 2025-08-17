import { DEFAULTS, ERROR_CODES } from '../src/constants';

describe('Constants', () => {
  describe('DEFAULTS', () => {
    it('should export default values', () => {
      expect(DEFAULTS).toBeDefined();
      expect(typeof DEFAULTS).toBe('object');
    });

    it('should have expected default properties', () => {
      expect(DEFAULTS).toHaveProperty('DEFAULT_TIMEOUT');
      expect(DEFAULTS).toHaveProperty('MAX_RETRY_ATTEMPTS');
      expect(DEFAULTS).toHaveProperty('PAGE_SIZE');
    });

    it('should have reasonable default values', () => {
      expect(DEFAULTS.DEFAULT_TIMEOUT).toBeGreaterThan(0);
      expect(DEFAULTS.MAX_RETRY_ATTEMPTS).toBeGreaterThan(0);
      expect(DEFAULTS.PAGE_SIZE).toBeGreaterThan(0);
      expect(DEFAULTS.PAGE_SIZE).toBeLessThanOrEqual(100);
    });
  });

  describe('ERROR_CODES', () => {
    it('should export error codes', () => {
      expect(ERROR_CODES).toBeDefined();
      expect(typeof ERROR_CODES).toBe('object');
    });

    it('should have expected error code properties', () => {
      expect(ERROR_CODES).toHaveProperty('VALIDATION_ERROR');
      expect(ERROR_CODES).toHaveProperty('NOT_FOUND');
      expect(ERROR_CODES).toHaveProperty('INTERNAL_SERVER_ERROR');
      expect(ERROR_CODES).toHaveProperty('UNAUTHORIZED');
      expect(ERROR_CODES).toHaveProperty('FORBIDDEN');
    });

    it('should have string values for error codes', () => {
      Object.values(ERROR_CODES).forEach((code: string) => {
        expect(typeof code).toBe('string');
        expect(code.length).toBeGreaterThan(0);
      });
    });

    it('should have unique error codes', () => {
      const values = Object.values(ERROR_CODES);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });
  });
});
