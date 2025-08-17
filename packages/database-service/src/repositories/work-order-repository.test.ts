import { PrismaClient } from '@prisma/client';
import { WorkOrderRepository } from './work-order-repository';

// Mock Prisma Client
const mockPrisma = {
  workOrder: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
} as unknown as PrismaClient;

describe('WorkOrderRepository', () => {
  let repository: WorkOrderRepository;

  beforeEach(() => {
    repository = new WorkOrderRepository(mockPrisma);
    jest.clearAllMocks();
  });

  describe('findById', () => {
    it('should find a work order by id', async () => {
      const mockWorkOrder = {
        id: 'test-id',
        status: 'PENDING',
        priority: 'MEDIUM',
        workflowId: 'test-workflow',
        tenantId: 'test-tenant',
        createdBy: 'test-user',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {},
        workItems: [],
      };

      (mockPrisma.workOrder.findUnique as jest.Mock).mockResolvedValue(mockWorkOrder);

      const result = await repository.findById('test-id');

      expect(result).toEqual(mockWorkOrder);
      expect(mockPrisma.workOrder.findUnique).toHaveBeenCalledWith({
        where: { id: 'test-id' },
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
    });

    it('should return null when work order not found', async () => {
      (mockPrisma.workOrder.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await repository.findById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a new work order', async () => {
      const createData = {
        status: 'PENDING' as const,
        priority: 'HIGH' as const,
        workflowId: 'test-workflow',
        tenantId: 'test-tenant',
        createdBy: 'test-user',
        metadata: { source: 'test' },
      };

      const mockCreatedWorkOrder = {
        id: 'new-id',
        ...createData,
        createdAt: new Date(),
        updatedAt: new Date(),
        workItems: [],
      };

      (mockPrisma.workOrder.create as jest.Mock).mockResolvedValue(mockCreatedWorkOrder);

      const result = await repository.create(createData);

      expect(result).toEqual(mockCreatedWorkOrder);
      expect(mockPrisma.workOrder.create).toHaveBeenCalledWith({
        data: createData,
        include: {
          workItems: true,
        },
      });
    });
  });

  describe('findByTenantId', () => {
    it('should find work orders by tenant id', async () => {
      const mockWorkOrders = [
        {
          id: 'work-order-1',
          tenantId: 'test-tenant',
          status: 'PENDING',
          priority: 'MEDIUM',
          workflowId: 'test-workflow',
          createdBy: 'test-user',
          createdAt: new Date(),
          updatedAt: new Date(),
          metadata: {},
          workItems: [],
        },
      ];

      (mockPrisma.workOrder.findMany as jest.Mock).mockResolvedValue(mockWorkOrders);
      (mockPrisma.workOrder.count as jest.Mock).mockResolvedValue(1);

      const result = await repository.findByTenantId('test-tenant');

      expect(result.data).toEqual(mockWorkOrders);
      expect(result.total).toBe(1);
      expect(mockPrisma.workOrder.findMany).toHaveBeenCalledWith({
        where: { tenantId: 'test-tenant' },
        skip: 0,
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          workItems: true,
        },
      });
    });
  });
});