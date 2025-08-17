/**
 * Policy Service
 *
 * Manages human-in-the-loop policy evaluation, approval workflows, and audit trails.
 * Implements the Policy MCP protocol for decision management.
 */

import { createLogger } from '@myloware/shared';

const logger = createLogger('policy-service:policy');

export interface PolicyRule {
  id: string;
  name: string;
  description: string;
  version: string;
  conditions: PolicyCondition[];
  actions: PolicyAction[];
  requiresApproval: boolean;
  approvers: string[];
  createdAt: Date;
  updatedAt: Date;
  isActive: boolean;
}

export interface PolicyCondition {
  field: string;
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains' | 'regex';
  value: any;
  description: string;
}

export interface PolicyAction {
  type: 'approve' | 'reject' | 'escalate' | 'notify' | 'delay';
  parameters: Record<string, any>;
  description: string;
}

export interface PolicyEvaluationRequest {
  id: string;
  policyId: string;
  context: Record<string, any>;
  requestedBy: string;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  metadata?: Record<string, any>;
}

export interface PolicyEvaluationResult {
  id: string;
  policyId: string;
  requestId: string;
  decision: 'APPROVED' | 'REJECTED' | 'PENDING' | 'ESCALATED';
  reason: string;
  approver?: string;
  approvedAt?: Date;
  requiresHumanApproval: boolean;
  auditTrail: PolicyAuditEntry[];
}

export interface PolicyAuditEntry {
  id: string;
  timestamp: Date;
  action: string;
  actor: string;
  details: Record<string, any>;
  reason?: string;
}

export interface ApprovalRequest {
  id: string;
  policyId: string;
  evaluationId: string;
  requestedBy: string;
  approvers: string[];
  context: Record<string, any>;
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
  createdAt: Date;
  expiresAt?: Date;
  approvedBy?: string;
  approvedAt?: Date;
  rejectedBy?: string;
  rejectedAt?: Date;
  reason?: string;
}

export class PolicyService {
  private policies: Map<string, PolicyRule> = new Map();
  private evaluations: Map<string, PolicyEvaluationResult> = new Map();
  private approvalRequests: Map<string, ApprovalRequest> = new Map();
  private auditLog: PolicyAuditEntry[] = [];

  /**
   * Initialize the policy service
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing Policy MCP service');

      // Load existing policies from database (simulation)
      await this.loadPolicies();

      // Load pending approval requests
      await this.loadApprovalRequests();

      logger.info('Policy MCP service initialized successfully', {
        policyCount: this.policies.size,
        pendingApprovals: this.approvalRequests.size,
      });
    } catch (error) {
      logger.error('Failed to initialize Policy MCP service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Create a new policy rule
   */
  async createPolicy(
    policyData: Omit<PolicyRule, 'id' | 'createdAt' | 'updatedAt'>
  ): Promise<PolicyRule> {
    try {
      const policy: PolicyRule = {
        ...policyData,
        id: this.generatePolicyId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.policies.set(policy.id, policy);

      // Add audit entry
      this.addAuditEntry({
        id: this.generateAuditId(),
        timestamp: new Date(),
        action: 'policy_created',
        actor: 'system',
        details: { policyId: policy.id, name: policy.name },
      });

      logger.info('Policy created', {
        policyId: policy.id,
        name: policy.name,
        version: policy.version,
      });

      return policy;
    } catch (error) {
      logger.error('Failed to create policy', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Evaluate a policy against given context
   */
  async evaluatePolicy(request: PolicyEvaluationRequest): Promise<PolicyEvaluationResult> {
    try {
      const policy = this.policies.get(request.policyId);

      if (!policy) {
        throw new Error(`Policy not found: ${request.policyId}`);
      }

      if (!policy.isActive) {
        throw new Error(`Policy is inactive: ${request.policyId}`);
      }

      logger.info('Evaluating policy', {
        policyId: request.policyId,
        requestId: request.id,
        requestedBy: request.requestedBy,
      });

      // Evaluate conditions
      const conditionsMatch = this.evaluateConditions(policy.conditions, request.context);

      const evaluation: PolicyEvaluationResult = {
        id: this.generateEvaluationId(),
        policyId: request.policyId,
        requestId: request.id,
        decision: 'PENDING',
        reason: '',
        requiresHumanApproval: policy.requiresApproval,
        auditTrail: [],
      };

      if (!conditionsMatch) {
        evaluation.decision = 'REJECTED';
        evaluation.reason = 'Policy conditions not met';
      } else if (!policy.requiresApproval) {
        evaluation.decision = 'APPROVED';
        evaluation.reason = 'Policy conditions met, no approval required';
      } else {
        // Create approval request
        const approvalRequest = await this.createApprovalRequest(request, evaluation.id);
        evaluation.reason = `Human approval required - request ${approvalRequest.id} created`;
      }

      // Add audit entry
      const auditEntry: PolicyAuditEntry = {
        id: this.generateAuditId(),
        timestamp: new Date(),
        action: 'policy_evaluated',
        actor: request.requestedBy,
        details: {
          policyId: request.policyId,
          decision: evaluation.decision,
          conditionsMatch,
        },
      };

      evaluation.auditTrail.push(auditEntry);
      this.addAuditEntry(auditEntry);

      this.evaluations.set(evaluation.id, evaluation);

      logger.info('Policy evaluation completed', {
        evaluationId: evaluation.id,
        policyId: request.policyId,
        decision: evaluation.decision,
        requiresApproval: evaluation.requiresHumanApproval,
      });

      return evaluation;
    } catch (error) {
      logger.error('Failed to evaluate policy', {
        policyId: request.policyId,
        requestId: request.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Create approval request for human decision
   */
  async createApprovalRequest(
    evaluationRequest: PolicyEvaluationRequest,
    evaluationId: string
  ): Promise<ApprovalRequest> {
    try {
      const policy = this.policies.get(evaluationRequest.policyId);

      if (!policy) {
        throw new Error(`Policy not found: ${evaluationRequest.policyId}`);
      }

      const approvalRequest: ApprovalRequest = {
        id: this.generateApprovalId(),
        policyId: evaluationRequest.policyId,
        evaluationId,
        requestedBy: evaluationRequest.requestedBy,
        approvers: policy.approvers,
        context: evaluationRequest.context,
        priority: evaluationRequest.priority,
        status: 'PENDING',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      };

      this.approvalRequests.set(approvalRequest.id, approvalRequest);

      // Add audit entry
      this.addAuditEntry({
        id: this.generateAuditId(),
        timestamp: new Date(),
        action: 'approval_request_created',
        actor: evaluationRequest.requestedBy,
        details: {
          approvalId: approvalRequest.id,
          policyId: evaluationRequest.policyId,
          approvers: policy.approvers,
        },
      });

      logger.info('Approval request created', {
        approvalId: approvalRequest.id,
        policyId: evaluationRequest.policyId,
        approvers: policy.approvers,
        priority: evaluationRequest.priority,
      });

      return approvalRequest;
    } catch (error) {
      logger.error('Failed to create approval request', {
        policyId: evaluationRequest.policyId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Process approval decision
   */
  async processApproval(
    approvalId: string,
    decision: 'APPROVED' | 'REJECTED',
    approver: string,
    reason?: string
  ): Promise<void> {
    try {
      const approvalRequest = this.approvalRequests.get(approvalId);

      if (!approvalRequest) {
        throw new Error(`Approval request not found: ${approvalId}`);
      }

      if (approvalRequest.status !== 'PENDING') {
        throw new Error(`Approval request already processed: ${approvalId}`);
      }

      // Check if approver is authorized
      if (!approvalRequest.approvers.includes(approver)) {
        throw new Error(`Unauthorized approver: ${approver}`);
      }

      // Update approval request
      approvalRequest.status = decision;
      if (reason) {
        approvalRequest.reason = reason;
      }

      if (decision === 'APPROVED') {
        approvalRequest.approvedBy = approver;
        approvalRequest.approvedAt = new Date();
      } else {
        approvalRequest.rejectedBy = approver;
        approvalRequest.rejectedAt = new Date();
      }

      // Update evaluation result
      const evaluation = this.evaluations.get(approvalRequest.evaluationId);
      if (evaluation) {
        evaluation.decision = decision;
        evaluation.approver = approver;
        evaluation.approvedAt = new Date();
        evaluation.reason = reason || `${decision.toLowerCase()} by ${approver}`;
      }

      // Add audit entry
      const auditEntry: PolicyAuditEntry = {
        id: this.generateAuditId(),
        timestamp: new Date(),
        action: `approval_${decision.toLowerCase()}`,
        actor: approver,
        details: {
          approvalId,
          policyId: approvalRequest.policyId,
          evaluationId: approvalRequest.evaluationId,
        },
      };

      if (reason) {
        auditEntry.reason = reason;
      }

      this.addAuditEntry(auditEntry);

      logger.info('Approval processed', {
        approvalId,
        decision,
        approver,
        policyId: approvalRequest.policyId,
      });
    } catch (error) {
      logger.error('Failed to process approval', {
        approvalId,
        decision,
        approver,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get policy by ID
   */
  async getPolicy(policyId: string): Promise<PolicyRule | null> {
    return this.policies.get(policyId) || null;
  }

  /**
   * Get evaluation result by ID
   */
  async getEvaluation(evaluationId: string): Promise<PolicyEvaluationResult | null> {
    return this.evaluations.get(evaluationId) || null;
  }

  /**
   * Get approval request by ID
   */
  async getApprovalRequest(approvalId: string): Promise<ApprovalRequest | null> {
    return this.approvalRequests.get(approvalId) || null;
  }

  /**
   * List pending approval requests for an approver
   */
  async getPendingApprovals(approver: string): Promise<ApprovalRequest[]> {
    return Array.from(this.approvalRequests.values()).filter(
      request =>
        request.status === 'PENDING' &&
        request.approvers.includes(approver) &&
        (!request.expiresAt || request.expiresAt > new Date())
    );
  }

  /**
   * Get audit trail for a specific entity
   */
  getAuditTrail(
    entityId: string,
    entityType: 'policy' | 'evaluation' | 'approval'
  ): PolicyAuditEntry[] {
    return this.auditLog.filter(entry => entry.details[`${entityType}Id`] === entityId);
  }

  /**
   * Evaluate policy conditions against context
   */
  private evaluateConditions(conditions: PolicyCondition[], context: Record<string, any>): boolean {
    for (const condition of conditions) {
      const contextValue = context[condition.field];
      const conditionValue = condition.value;

      let matches = false;

      switch (condition.operator) {
        case 'equals':
          matches = contextValue === conditionValue;
          break;
        case 'not_equals':
          matches = contextValue !== conditionValue;
          break;
        case 'greater_than':
          matches = Number(contextValue) > Number(conditionValue);
          break;
        case 'less_than':
          matches = Number(contextValue) < Number(conditionValue);
          break;
        case 'contains':
          matches = String(contextValue).includes(String(conditionValue));
          break;
        case 'regex':
          matches = new RegExp(conditionValue).test(String(contextValue));
          break;
        default:
          logger.warn('Unknown condition operator', { operator: condition.operator });
          matches = false;
      }

      if (!matches) {
        logger.debug('Policy condition not met', {
          field: condition.field,
          operator: condition.operator,
          expected: conditionValue,
          actual: contextValue,
        });
        return false;
      }
    }

    return true;
  }

  /**
   * Add entry to audit log
   */
  private addAuditEntry(entry: PolicyAuditEntry): void {
    this.auditLog.push(entry);

    // Keep only last 10000 entries to prevent memory issues
    if (this.auditLog.length > 10000) {
      this.auditLog = this.auditLog.slice(-10000);
    }
  }

  /**
   * Load existing policies from database (simulation)
   */
  private async loadPolicies(): Promise<void> {
    // In a real implementation, this would load from the database
    logger.debug('Loading existing policies from database');

    // Create some default policies for demonstration
    const defaultPolicies: PolicyRule[] = [
      {
        id: 'policy_high_value_approval',
        name: 'High Value Transaction Approval',
        description: 'Requires approval for transactions over $10,000',
        version: '1.0.0',
        conditions: [
          {
            field: 'amount',
            operator: 'greater_than',
            value: 10000,
            description: 'Transaction amount exceeds $10,000',
          },
        ],
        actions: [
          {
            type: 'escalate',
            parameters: { escalation_level: 'manager' },
            description: 'Escalate to manager for approval',
          },
        ],
        requiresApproval: true,
        approvers: ['manager_001', 'finance_lead'],
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      },
      {
        id: 'policy_sensitive_data_access',
        name: 'Sensitive Data Access Policy',
        description: 'Controls access to sensitive customer data',
        version: '1.0.0',
        conditions: [
          {
            field: 'data_classification',
            operator: 'equals',
            value: 'SENSITIVE',
            description: 'Data is classified as sensitive',
          },
        ],
        actions: [
          {
            type: 'notify',
            parameters: { notification_type: 'security_alert' },
            description: 'Send security notification',
          },
        ],
        requiresApproval: true,
        approvers: ['security_team', 'data_protection_officer'],
        createdAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      },
    ];

    for (const policy of defaultPolicies) {
      this.policies.set(policy.id, policy);
    }

    logger.info('Default policies loaded', { count: defaultPolicies.length });
  }

  /**
   * Load existing approval requests from database (simulation)
   */
  private async loadApprovalRequests(): Promise<void> {
    // In a real implementation, this would load from the database
    logger.debug('Loading existing approval requests from database');

    // For now, start with empty requests
    this.approvalRequests.clear();
  }

  /**
   * Generate unique policy ID
   */
  private generatePolicyId(): string {
    return `policy_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate unique evaluation ID
   */
  private generateEvaluationId(): string {
    return `eval_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate unique approval ID
   */
  private generateApprovalId(): string {
    return `approval_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Generate unique audit ID
   */
  private generateAuditId(): string {
    return `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Get service statistics
   */
  getStats(): {
    totalPolicies: number;
    activePolicies: number;
    pendingEvaluations: number;
    pendingApprovals: number;
    auditEntries: number;
  } {
    const activePolicies = Array.from(this.policies.values()).filter(p => p.isActive).length;
    const pendingEvaluations = Array.from(this.evaluations.values()).filter(
      e => e.decision === 'PENDING'
    ).length;
    const pendingApprovals = Array.from(this.approvalRequests.values()).filter(
      r => r.status === 'PENDING'
    ).length;

    return {
      totalPolicies: this.policies.size,
      activePolicies,
      pendingEvaluations,
      pendingApprovals,
      auditEntries: this.auditLog.length,
    };
  }

  /**
   * Stop the policy service
   */
  async stop(): Promise<void> {
    try {
      logger.info('Stopping Policy MCP service');

      // Save any pending state (in real implementation)

      logger.info('Policy MCP service stopped successfully');
    } catch (error) {
      logger.error('Error stopping Policy MCP service', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }
}
