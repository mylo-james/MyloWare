import { PrismaClient } from '@prisma/client';
import { DatabaseConfig } from '../types';

export class DatabaseClient {
  private static instance: DatabaseClient;
  private prisma: PrismaClient;

  private constructor(config?: DatabaseConfig) {
    this.prisma = new PrismaClient({
      datasources: {
        db: {
          url: config?.url || process.env['DATABASE_URL'] || 'postgresql://localhost:5432/myloware',
        },
      },
      log: process.env['NODE_ENV'] === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
    });
  }

  public static getInstance(config?: DatabaseConfig): DatabaseClient {
    if (!DatabaseClient.instance) {
      DatabaseClient.instance = new DatabaseClient(config);
    }
    return DatabaseClient.instance;
  }

  public get client(): PrismaClient {
    return this.prisma;
  }

  public async connect(): Promise<void> {
    try {
      await this.prisma.$connect();
      console.log('✅ Database connection established');
    } catch (error) {
      console.error('❌ Failed to connect to database:', error);
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    try {
      await this.prisma.$disconnect();
      console.log('✅ Database connection closed');
    } catch (error) {
      console.error('❌ Failed to disconnect from database:', error);
      throw error;
    }
  }

  public async healthCheck(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      console.error('❌ Database health check failed:', error);
      return false;
    }
  }

  public async executeTransaction<T>(
    operations: (prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
  ): Promise<T> {
    return this.prisma.$transaction(operations);
  }
}