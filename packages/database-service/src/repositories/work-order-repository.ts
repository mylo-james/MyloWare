import { PrismaClient, WorkOrder, Prisma, WorkOrderStatus, MemDocType } from '@prisma/client';
import { BaseRepositoryImpl } from './base-repository';
import { QueryOptions, PaginatedResult } from '../types';

export class WorkOrderRepository extends BaseRepositoryImpl<
  WorkOrder,
  Prisma.WorkOrderCreateInput,
  Prisma.WorkOrderUpdateInput
> {
  constructor(prisma: PrismaClient) {
    super(prisma, 'WorkOrder');
  }

  async findById(id: string): Promise<WorkOrder | null> {
    return this.prisma.workOrder.findUnique({
      where: { id },
      include: {
        workItems: {
          include: {
            attempts: true,
            memDocs: true,
            approvalEvents: true,
            evalResults: true,
          },
        },
      },
    });
  }

  async findMany(options?: QueryOptions): Promise<PaginatedResult<WorkOrder>> {
    const pagination = this.buildPaginationQuery(options);
    const orderBy = this.buildSortQuery(options);

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        ...pagination,
        orderBy,
        include: options?.include || {
          workItems: true,
        },
      }),
      this.prisma.workOrder.count(),
    ]);

    return this.buildPaginatedResult(data, total, options);
  }

  async create(data: Prisma.WorkOrderCreateInput): Promise<WorkOrder> {
    return this.prisma.workOrder.create({
      data,
      include: {
        workItems: true,
      },
    });
  }

  async update(id: string, data: Prisma.WorkOrderUpdateInput): Promise<WorkOrder> {
    return this.prisma.workOrder.update({
      where: { id },
      data,
      include: {
        workItems: true,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.workOrder.delete({
      where: { id },
    });
  }

  // Custom methods for work orders
  async findByTenantId(tenantId: string, options?: QueryOptions): Promise<PaginatedResult<WorkOrder>> {
    const pagination = this.buildPaginationQuery(options);
    const orderBy = this.buildSortQuery(options);

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: { tenantId },
        ...pagination,
        orderBy,
        include: {
          workItems: true,
        },
      }),
      this.prisma.workOrder.count({
        where: { tenantId },
      }),
    ]);

    return this.buildPaginatedResult(data, total, options);
  }

  async findByStatus(
    status: WorkOrderStatus,
    options?: QueryOptions
  ): Promise<PaginatedResult<WorkOrder>> {
    const pagination = this.buildPaginationQuery(options);
    const orderBy = this.buildSortQuery(options);

    const [data, total] = await Promise.all([
      this.prisma.workOrder.findMany({
        where: { status },
        ...pagination,
        orderBy,
        include: {
          workItems: true,
        },
      }),
      this.prisma.workOrder.count({
        where: { status },
      }),
    ]);

    return this.buildPaginatedResult(data, total, options);
  }

  async updateStatus(id: string, status: WorkOrderStatus): Promise<WorkOrder> {
    return this.prisma.workOrder.update({
      where: { id },
      data: { status },
      include: {
        workItems: true,
      },
    });
  }
}