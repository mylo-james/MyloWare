process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.MCP_AUTH_KEY = process.env.MCP_AUTH_KEY || '00000000-0000-0000-0000-000000000000';
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || 'test-telegram-token';
process.env.N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'https://example.com/webhook';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@127.0.0.1:6543/mcp_v2_test';
process.env.OPERATIONS_DATABASE_URL =
  process.env.OPERATIONS_DATABASE_URL || process.env.DATABASE_URL;
