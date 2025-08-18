/**
 * Slack Commands Controller Tests
 */

import {
  SlackCommandsController,
  SlackCommandPayload,
} from '../src/controllers/slack-commands.controller';

// Mock dependencies
const mockSlackCommandService = {
  processCommand: jest.fn(),
  getHealthStatus: jest.fn(),
};

const mockSlackVerificationMiddleware = {
  verifySlackRequest: jest.fn(),
  getVerificationStatus: jest.fn(),
};

describe('SlackCommandsController', () => {
  let controller: SlackCommandsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new SlackCommandsController(
      mockSlackCommandService as any,
      mockSlackVerificationMiddleware as any
    );
  });

  const mockPayload: SlackCommandPayload = {
    token: 'test-token',
    team_id: 'T123',
    team_domain: 'test-team',
    channel_id: 'C123',
    channel_name: 'test-channel',
    user_id: 'U123',
    user_name: 'testuser',
    command: '/mylo',
    text: 'help',
    response_url: 'https://hooks.slack.com/commands/123',
    trigger_id: 'trigger-123',
  };

  const mockHeaders = {
    'x-slack-request-timestamp': '1234567890',
    'x-slack-signature': 'v0=test-signature',
  };

  describe('handleMyloCommand', () => {
    it('should process valid command successfully', async () => {
      // Arrange
      mockSlackVerificationMiddleware.verifySlackRequest.mockResolvedValue(true);
      mockSlackCommandService.processCommand.mockResolvedValue({
        response_type: 'ephemeral',
        text: 'Command processed successfully',
      });

      // Act
      const result = await controller.handleMyloCommand(mockPayload, mockHeaders);

      // Assert
      expect(mockSlackVerificationMiddleware.verifySlackRequest).toHaveBeenCalledWith(
        mockHeaders,
        JSON.stringify(mockPayload)
      );
      expect(mockSlackCommandService.processCommand).toHaveBeenCalledWith(mockPayload);
      expect(result).toEqual({
        response_type: 'ephemeral',
        text: 'Command processed successfully',
      });
    });

    it('should reject invalid signature', async () => {
      // Arrange
      mockSlackVerificationMiddleware.verifySlackRequest.mockResolvedValue(false);

      // Act & Assert
      await expect(controller.handleMyloCommand(mockPayload, mockHeaders)).rejects.toThrow(
        'Invalid request signature'
      );

      expect(mockSlackVerificationMiddleware.verifySlackRequest).toHaveBeenCalledWith(
        mockHeaders,
        JSON.stringify(mockPayload)
      );
      expect(mockSlackCommandService.processCommand).not.toHaveBeenCalled();
    });

    it('should handle service errors gracefully', async () => {
      // Arrange
      mockSlackVerificationMiddleware.verifySlackRequest.mockResolvedValue(true);
      mockSlackCommandService.processCommand.mockRejectedValue(new Error('Service error'));

      // Act
      const result = await controller.handleMyloCommand(mockPayload, mockHeaders);

      // Assert
      expect(result).toEqual({
        response_type: 'ephemeral',
        text: '❌ Command failed: Service error',
      });
    });

    it('should handle unknown errors gracefully', async () => {
      // Arrange
      mockSlackVerificationMiddleware.verifySlackRequest.mockResolvedValue(true);
      mockSlackCommandService.processCommand.mockRejectedValue('Unknown error');

      // Act
      const result = await controller.handleMyloCommand(mockPayload, mockHeaders);

      // Assert
      expect(result).toEqual({
        response_type: 'ephemeral',
        text: '❌ Command failed: Unknown error',
      });
    });
  });
});
