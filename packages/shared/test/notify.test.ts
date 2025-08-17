import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  sendNotification,
  notifySuccess,
  notifyImportant,
  notifyError,
  notifyStoryComplete,
  notifyTestResults,
  notifyDeployment,
  isNotificationAvailable,
  NotificationOptions,
} from '../src/utils/notify';

// Mock child_process
jest.mock('child_process');
jest.mock('fs');
jest.mock('path');

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockFsExistsSync = fs.existsSync as jest.MockedFunction<typeof fs.existsSync>;
const mockPathJoin = path.join as jest.MockedFunction<typeof path.join>;

describe('Notification Utilities', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathJoin.mockReturnValue('/mock/path/notify-completion.js');
  });

  describe('sendNotification', () => {
    it('should send notification successfully', () => {
      const options: NotificationOptions = {
        message: 'Test message',
        priority: 1,
        title: 'Test Title',
      };

      mockExecSync.mockReturnValue('Notification sent' as any);

      const result = sendNotification(options);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Notification sent successfully');
      expect(result.response).toBe('Notification sent');
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Test message" "1" "Test Title"',
        expect.objectContaining({
          encoding: 'utf8',
          stdio: 'pipe',
        })
      );
    });

    it('should use default values when not provided', () => {
      const options: NotificationOptions = {
        message: 'Test message',
      };

      mockExecSync.mockReturnValue('Notification sent' as any);

      const result = sendNotification(options);

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Test message" "0" "MyloWare Agent Notification"',
        expect.any(Object)
      );
    });

    it('should handle execution errors', () => {
      const options: NotificationOptions = {
        message: 'Test message',
      };

      const error = new Error('Script execution failed');
      mockExecSync.mockImplementation(() => {
        throw error;
      });

      const result = sendNotification(options);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to send notification: Script execution failed');
      expect(result.response).toBeUndefined();
    });

    it('should handle non-Error exceptions', () => {
      const options: NotificationOptions = {
        message: 'Test message',
      };

      mockExecSync.mockImplementation(() => {
        throw 'String error';
      });

      const result = sendNotification(options);

      expect(result.success).toBe(false);
      expect(result.message).toBe('Failed to send notification: String error');
    });
  });

  describe('notifySuccess', () => {
    it('should send success notification with priority 0', () => {
      mockExecSync.mockReturnValue('Success' as any);

      const result = notifySuccess('Task completed', 'Custom Title');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Task completed" "0" "Custom Title"',
        expect.any(Object)
      );
    });

    it('should use default title when not provided', () => {
      mockExecSync.mockReturnValue('Success' as any);

      const result = notifySuccess('Task completed');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Task completed" "0" "MyloWare Success"',
        expect.any(Object)
      );
    });
  });

  describe('notifyImportant', () => {
    it('should send important notification with priority 1', () => {
      mockExecSync.mockReturnValue('Important' as any);

      const result = notifyImportant('Important task', 'Custom Title');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Important task" "1" "Custom Title"',
        expect.any(Object)
      );
    });

    it('should use default title when not provided', () => {
      mockExecSync.mockReturnValue('Important' as any);

      const result = notifyImportant('Important task');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Important task" "1" "MyloWare Important"',
        expect.any(Object)
      );
    });
  });

  describe('notifyError', () => {
    it('should send error notification with priority 2', () => {
      mockExecSync.mockReturnValue('Error' as any);

      const result = notifyError('Error occurred', 'Custom Title');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Error occurred" "2" "Custom Title"',
        expect.any(Object)
      );
    });

    it('should use default title when not provided', () => {
      mockExecSync.mockReturnValue('Error' as any);

      const result = notifyError('Error occurred');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Error occurred" "2" "MyloWare Error"',
        expect.any(Object)
      );
    });
  });

  describe('notifyStoryComplete', () => {
    it('should send story completion notification with details', () => {
      mockExecSync.mockReturnValue('Story complete' as any);

      const result = notifyStoryComplete('1.2', 'Database schema implemented');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Story 1.2 completed successfully: Database schema implemented" "1" "MyloWare Story Complete"',
        expect.any(Object)
      );
    });

    it('should send story completion notification without details', () => {
      mockExecSync.mockReturnValue('Story complete' as any);

      const result = notifyStoryComplete('1.2');

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Story 1.2 completed successfully" "1" "MyloWare Story Complete"',
        expect.any(Object)
      );
    });
  });

  describe('notifyTestResults', () => {
    it('should send test results notification with coverage', () => {
      mockExecSync.mockReturnValue('Test results' as any);

      const result = notifyTestResults(47, 0, 89);

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Tests completed: 47 passed, 0 failed, coverage: 89%" "0" "MyloWare Test Results"',
        expect.any(Object)
      );
    });

    it('should send test results notification without coverage', () => {
      mockExecSync.mockReturnValue('Test results' as any);

      const result = notifyTestResults(45, 2);

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Tests completed: 45 passed, 2 failed" "2" "MyloWare Test Results"',
        expect.any(Object)
      );
    });

    it('should use priority 2 when tests fail', () => {
      mockExecSync.mockReturnValue('Test results' as any);

      const result = notifyTestResults(40, 5, 85);

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "Tests completed: 40 passed, 5 failed, coverage: 85%" "2" "MyloWare Test Results"',
        expect.any(Object)
      );
    });
  });

  describe('notifyDeployment', () => {
    it('should send successful deployment notification', () => {
      mockExecSync.mockReturnValue('Deployment success' as any);

      const result = notifyDeployment('production', 'v1.2.3', true);

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "production deployment successful - v1.2.3" "1" "MyloWare production Deployment"',
        expect.any(Object)
      );
    });

    it('should send failed deployment notification', () => {
      mockExecSync.mockReturnValue('Deployment failed' as any);

      const result = notifyDeployment('staging', 'v1.2.3', false);

      expect(result.success).toBe(true);
      expect(mockExecSync).toHaveBeenCalledWith(
        'node "/mock/path/notify-completion.js" "staging deployment failed - v1.2.3" "2" "MyloWare staging Deployment"',
        expect.any(Object)
      );
    });
  });

  describe('isNotificationAvailable', () => {
    it('should return true when notification script exists', () => {
      mockFsExistsSync.mockReturnValue(true);

      const result = isNotificationAvailable();

      expect(result).toBe(true);
      expect(mockFsExistsSync).toHaveBeenCalledWith('/mock/path/notify-completion.js');
    });

    it('should return false when notification script does not exist', () => {
      mockFsExistsSync.mockReturnValue(false);

      const result = isNotificationAvailable();

      expect(result).toBe(false);
      expect(mockFsExistsSync).toHaveBeenCalledWith('/mock/path/notify-completion.js');
    });

    it('should return false when fs.existsSync throws an error', () => {
      mockFsExistsSync.mockImplementation(() => {
        throw new Error('File system error');
      });

      const result = isNotificationAvailable();

      expect(result).toBe(false);
    });
  });
});
