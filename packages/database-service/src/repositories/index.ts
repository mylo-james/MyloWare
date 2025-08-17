export { BaseRepositoryImpl } from './base-repository';
export { WorkOrderRepository } from './work-order-repository';
export { MemDocRepository } from './mem-doc-repository';

// Repository factory for dependency injection
import { PrismaClient } from '@prisma/client';
import { WorkOrderRepository } from './work-order-repository';
import { MemDocRepository } from './mem-doc-repository';

export class RepositoryFactory {
  private prisma: PrismaClient;

  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }

  createWorkOrderRepository(): WorkOrderRepository {
    return new WorkOrderRepository(this.prisma);
  }

  createMemDocRepository(): MemDocRepository {
    return new MemDocRepository(this.prisma);
  }
}