import * as fs from 'fs';
import * as path from 'path';
import { envSchema } from '../validators/common-schemas';

/**
 * Environment variable loader for background agents
 * Provides centralized environment variable management with validation
 */
export class EnvLoader {
  private static instance: EnvLoader;
  private loaded = false;
  private envPath: string;

  private constructor() {
    // Look for .env file in project root
    this.envPath = this.findEnvFile();
  }

  public static getInstance(): EnvLoader {
    if (!EnvLoader.instance) {
      EnvLoader.instance = new EnvLoader();
    }
    return EnvLoader.instance;
  }

  /**
   * Find the .env file by walking up the directory tree
   */
  private findEnvFile(): string {
    let currentDir = process.cwd();
    const maxDepth = 10; // Prevent infinite loops
    let depth = 0;

    while (depth < maxDepth) {
      const envPath = path.join(currentDir, '.env');
      if (fs.existsSync(envPath)) {
        return envPath;
      }

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break; // Reached root directory
      }
      currentDir = parentDir;
      depth++;
    }

    return path.join(process.cwd(), '.env'); // Default fallback
  }

  /**
   * Load environment variables from .env file
   */
  public loadEnv(): void {
    if (this.loaded) {
      return; // Already loaded
    }

    if (fs.existsSync(this.envPath)) {
      console.log(`[ENV] Loading environment variables from: ${this.envPath}`);
      
      const envContent = fs.readFileSync(this.envPath, 'utf8');
      const envLines = envContent.split('\n');

      envLines.forEach((line, index) => {
        const trimmedLine = line.trim();
        if (trimmedLine && !trimmedLine.startsWith('#')) {
          const [key, ...valueParts] = trimmedLine.split('=');
          if (key && valueParts.length > 0) {
            const value = valueParts.join('=').replace(/^["']|["']$/g, '');
            process.env[key] = value;
          }
        }
      });

      this.loaded = true;
      console.log(`[ENV] Environment variables loaded successfully`);
    } else {
      console.warn(`[ENV] No .env file found at: ${this.envPath}`);
    }
  }

  /**
   * Validate required environment variables
   */
  public validateEnv(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    try {
      const { error } = envSchema.validate(process.env, { allowUnknown: true });
      if (error) {
        errors.push(`Environment validation failed: ${error.message}`);
      }
    } catch (err) {
      errors.push(`Environment validation error: ${err}`);
    }

    // Check for additional required variables
    const additionalRequired = [
      'PUSHOVER_USER_KEY',
      'PUSHOVER_APP_TOKEN'
    ];

    additionalRequired.forEach(key => {
      if (!process.env[key]) {
        errors.push(`Missing required environment variable: ${key}`);
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Get environment variable with fallback
   */
  public get(key: string, fallback?: string): string | undefined {
    if (!this.loaded) {
      this.loadEnv();
    }
    return process.env[key] || fallback;
  }

  /**
   * Get all environment variables as an object
   */
  public getAll(): Record<string, string | undefined> {
    if (!this.loaded) {
      this.loadEnv();
    }
    return { ...process.env };
  }

  /**
   * Check if environment is properly configured
   */
  public isConfigured(): boolean {
    const validation = this.validateEnv();
    return validation.valid;
  }

  /**
   * Print environment configuration status
   */
  public printStatus(): void {
    const validation = this.validateEnv();
    
    if (validation.valid) {
      console.log('[ENV] ✅ Environment configuration is valid');
    } else {
      console.error('[ENV] ❌ Environment configuration has errors:');
      validation.errors.forEach(error => {
        console.error(`  - ${error}`);
      });
    }
  }
}

/**
 * Convenience function to load environment variables
 */
export function loadEnvironmentVariables(): void {
  EnvLoader.getInstance().loadEnv();
}

/**
 * Convenience function to validate environment variables
 */
export function validateEnvironmentVariables(): { valid: boolean; errors: string[] } {
  return EnvLoader.getInstance().validateEnv();
}

/**
 * Convenience function to get environment variable
 */
export function getEnv(key: string, fallback?: string): string | undefined {
  return EnvLoader.getInstance().get(key, fallback);
}
