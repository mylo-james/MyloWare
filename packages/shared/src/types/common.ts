/**
 * Environment types
 */
export type Environment = 'development' | 'staging' | 'production';

/**
 * Log levels
 */
export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG';

/**
 * Base entity interface
 */
export interface BaseEntity {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Database connection configuration
 */
export interface DatabaseConfig {
  url: string;
  maxConnections?: number;
  connectionTimeout?: number;
}

/**
 * Redis configuration
 */
export interface RedisConfig {
  url: string;
  maxRetries?: number;
  retryDelay?: number;
}

/**
 * Temporal configuration
 */
export interface TemporalConfig {
  host: string;
  port: number;
  namespace?: string;
}
