/**
 * Policy Service Tests
 */

import { PolicyService } from '../src/services/policy.service';

describe('Policy Service', () => {
  let policyService: PolicyService;

  beforeEach(() => {
    policyService = new PolicyService();
  });

  describe('Initialization', () => {
    it('should initialize successfully', async () => {
      await expect(policyService.initialize()).resolves.not.toThrow();
    });

    it('should load default policies', async () => {
      await policyService.initialize();

      const stats = policyService.getStats();
      expect(stats.totalPolicies).toBeGreaterThan(0);
      expect(stats.activePolicies).toBeGreaterThan(0);
    });
  });

  describe('Policy Management', () => {
    beforeEach(async () => {
      await policyService.initialize();
    });

    it('should create new policies', async () => {
      const policyData = {
        name: 'Test Policy',
        description: 'A test policy',
        version: '1.0.0',
        conditions: [],
        actions: [],
        requiresApproval: false,
        approvers: [],
        isActive: true,
      };

      const policy = await policyService.createPolicy(policyData);

      expect(policy).toBeDefined();
      expect(policy.id).toMatch(/^policy_/);
      expect(policy.name).toBe('Test Policy');
    });

    it('should evaluate policies', async () => {
      // Get an existing policy
      const stats = policyService.getStats();
      expect(stats.totalPolicies).toBeGreaterThan(0);

      const evaluationRequest = {
        id: 'test_request',
        policyId: 'policy_high_value_approval',
        context: { amount: 5000 }, // Below threshold
        requestedBy: 'test_user',
        priority: 'MEDIUM' as const,
      };

      const result = await policyService.evaluatePolicy(evaluationRequest);

      expect(result).toBeDefined();
      expect(result.decision).toBeDefined();
      expect(['APPROVED', 'REJECTED', 'PENDING']).toContain(result.decision);
    });
  });

  describe('Service Statistics', () => {
    it('should provide service statistics', async () => {
      await policyService.initialize();

      const stats = policyService.getStats();

      expect(stats).toHaveProperty('totalPolicies');
      expect(stats).toHaveProperty('activePolicies');
      expect(stats).toHaveProperty('pendingEvaluations');
      expect(stats).toHaveProperty('pendingApprovals');
      expect(stats).toHaveProperty('auditEntries');
    });
  });
});
