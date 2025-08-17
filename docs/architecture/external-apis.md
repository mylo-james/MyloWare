# External APIs

## OpenAI API

- **Purpose:** Primary LLM provider for document processing and AI agent operations
- **Documentation:** https://platform.openai.com/docs
- **Base URL(s):** https://api.openai.com/v1
- **Authentication:** Bearer token (API key)
- **Rate Limits:** Varies by model and plan (typically 3,000-10,000 requests/minute)

**Key Endpoints Used:**

- `POST /chat/completions` - Generate text completions for document processing
- `POST /embeddings` - Generate embeddings for vector storage
- `POST /models` - List available models and capabilities

**Integration Notes:** Implement circuit breaker pattern, token budgeting, and fallback to alternative providers

## Anthropic API

- **Purpose:** Secondary LLM provider for redundancy and cost optimization
- **Documentation:** https://docs.anthropic.com/
- **Base URL(s):** https://api.anthropic.com
- **Authentication:** Bearer token (API key)
- **Rate Limits:** Varies by plan (typically 1,000-5,000 requests/minute)

**Key Endpoints Used:**

- `POST /v1/messages` - Generate text completions using Claude models
- `POST /v1/embeddings` - Generate embeddings for vector storage

**Integration Notes:** Used as fallback when OpenAI is unavailable or for specific use cases requiring Claude's capabilities

## Slack API

- **Purpose:** Primary user interface and notification system
- **Documentation:** https://api.slack.com/
- **Base URL(s):** https://slack.com/api
- **Authentication:** Bot token with OAuth scopes
- **Rate Limits:** 50 requests per second per workspace

**Key Endpoints Used:**

- `POST /chat.postMessage` - Send messages to channels or users
- `POST /views.open` - Open modal dialogs for user interaction
- `POST /chat.postEphemeral` - Send temporary messages
- `GET /users.list` - Retrieve user information
- `POST /reactions.add` - Add reactions to messages

**Integration Notes:** Implement Socket Mode for real-time events, handle rate limiting, and manage bot token lifecycle
