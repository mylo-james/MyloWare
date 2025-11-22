# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2025-11-22

### Added
- Production-ready multi-agent orchestration platform
- Complete Test Video Gen and AISMR pipelines
- Comprehensive documentation set for public release
- 82% test coverage with enforced CI gates

### Added
- AISMR video generation pipeline with specialized personas (Iggy, Riley, Alex, Quinn)
- Telegram integration for workflow triggers via Brendan chat interface
- HITL (Human-in-the-Loop) workflow approval gates with signed tokens
- Dead Letter Queue (DLQ) for webhook replay and reliability
- Comprehensive observability stack (LangSmith, Prometheus, Grafana, Sentry)
- FFmpeg video normalization post-processing for consistent output
- Contract enforcement for persona tool usage
- Provider mocking system with automatic test protection

### Changed
- Refactored persona orchestration to use LangGraph state machines
- Consolidated Brendan interactions through single chat endpoint
- Improved webhook signature verification and idempotency handling

### Fixed
- Webhook signature verification edge cases with timing windows
- Memory leaks in long-running orchestrator processes
- Persona tool allowlist enforcement (fail-fast on contract violations)
- Circuit breaker state management for external providers
- LangGraph checkpoint persistence across graph rebuilds

### Changed
- Consolidated all implementation into production-ready v1.0 release
- Cleaned up documentation to remove historical implementation details
- Updated roadmap with post-1.0 milestone numbering

[Unreleased]: https://github.com/mylo-james/myloware/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/mylo-james/myloware/releases/tag/v1.0.0
