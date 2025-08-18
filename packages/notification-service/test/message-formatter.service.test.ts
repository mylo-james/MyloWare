import { MessageFormatterService } from '../src/services/message-formatter.service';

describe('MessageFormatterService', () => {
  const svc = new MessageFormatterService();

  test('formats run status tag', () => {
    expect(svc.formatRunStatusTag('run_123', 'STARTED')).toBe('[RUN run_123][STARTED]');
  });

  test('formats metadata table', () => {
    const txt = svc.formatRunMetadataTable({ status: 'In Progress', agent: 'ExtractorLLM' });
    expect(txt).toContain('📊 *Run Details*');
    expect(txt).toContain('• Status: In Progress');
    expect(txt).toContain('• Agent: ExtractorLLM');
  });

  test('formats initial run message', () => {
    const txt = svc.formatInitialRunMessage('run_9', 'Starting workflow');
    expect(txt).toContain('[RUN run_9][STARTED]');
    expect(txt).toContain('Starting workflow');
  });
});
