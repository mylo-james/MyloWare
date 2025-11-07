import { describe, it, expect, beforeEach } from 'vitest';
import { AgentWebhookRepository } from '@/db/repositories/agent-webhook-repository.js';
import { db } from '@/db/client.js';
import { agentWebhooks } from '@/db/schema.js';

describe('AgentWebhookRepository', () => {
  const repository = new AgentWebhookRepository();

  beforeEach(async () => {
    await db.delete(agentWebhooks);
  });

  describe('create', () => {
    it('should create a new agent webhook', async () => {
      const webhook = await repository.create({
        agentName: 'test-agent',
        webhookPath: '/webhook/test',
        description: 'Test agent',
      });

      expect(webhook.id).toBeDefined();
      expect(webhook.agentName).toBe('test-agent');
      expect(webhook.webhookPath).toBe('/webhook/test');
      expect(webhook.method).toBe('POST');
      expect(webhook.authType).toBe('none');
      expect(webhook.isActive).toBe(true);
      expect(webhook.createdAt).toBeInstanceOf(Date);
    });

    it('should create with custom auth config', async () => {
      const webhook = await repository.create({
        agentName: 'test-agent-auth',
        webhookPath: '/webhook/test',
        authType: 'header',
        authConfig: { headerName: 'x-custom-header', token: 'secret-token' },
        timeoutMs: 60000,
      });

      expect(webhook.authType).toBe('header');
      expect(webhook.authConfig).toEqual({ headerName: 'x-custom-header', token: 'secret-token' });
      expect(webhook.timeoutMs).toBe(60000);
    });

    it('should create inactive webhook when specified', async () => {
      const webhook = await repository.create({
        agentName: 'inactive-agent',
        webhookPath: '/webhook/inactive',
        isActive: false,
      });

      expect(webhook.isActive).toBe(false);
    });
  });

  describe('findByAgentName', () => {
    it('should find webhook by agent name', async () => {
      await repository.create({
        agentName: 'test-agent',
        webhookPath: '/webhook/test',
      });

      const found = await repository.findByAgentName('test-agent');

      expect(found).toBeDefined();
      expect(found?.agentName).toBe('test-agent');
      expect(found?.webhookPath).toBe('/webhook/test');
    });

    it('should return null for non-existent agent', async () => {
      const found = await repository.findByAgentName('non-existent');
      expect(found).toBeNull();
    });
  });

  describe('findActiveAgents', () => {
    it('should find all active agents', async () => {
      await repository.create({
        agentName: 'active-1',
        webhookPath: '/webhook/active1',
        isActive: true,
      });
      await repository.create({
        agentName: 'active-2',
        webhookPath: '/webhook/active2',
        isActive: true,
      });
      await repository.create({
        agentName: 'inactive-1',
        webhookPath: '/webhook/inactive1',
        isActive: false,
      });

      const active = await repository.findActiveAgents();

      expect(active.length).toBe(2);
      expect(active.every(a => a.isActive)).toBe(true);
      expect(active.map(a => a.agentName)).toContain('active-1');
      expect(active.map(a => a.agentName)).toContain('active-2');
      expect(active.map(a => a.agentName)).not.toContain('inactive-1');
    });

    it('should return empty array when no active agents', async () => {
      await repository.create({
        agentName: 'inactive-1',
        webhookPath: '/webhook/inactive1',
        isActive: false,
      });

      const active = await repository.findActiveAgents();

      expect(active.length).toBe(0);
    });
  });

  describe('updateActive', () => {
    it('should update agent active status', async () => {
      const webhook = await repository.create({
        agentName: 'test-agent',
        webhookPath: '/webhook/test',
        isActive: true,
      });

      const updated = await repository.updateActive('test-agent', false);

      expect(updated).toBeDefined();
      expect(updated?.isActive).toBe(false);
      expect(updated?.updatedAt).toBeInstanceOf(Date);
    });

    it('should activate inactive agent', async () => {
      const webhook = await repository.create({
        agentName: 'test-agent',
        webhookPath: '/webhook/test',
        isActive: false,
      });

      const updated = await repository.updateActive('test-agent', true);

      expect(updated?.isActive).toBe(true);
    });

    it('should return null for non-existent agent', async () => {
      const updated = await repository.updateActive('non-existent', true);
      expect(updated).toBeNull();
    });
  });
});

