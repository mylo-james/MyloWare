"""Internal provider boundaries.

These interfaces keep the codebase "Llama Stack-native" while still making the
boundary between *our* app logic and *vendor* SDKs explicit and testable.
"""

from __future__ import annotations

from myloware.backends.llama_stack import LlamaStackBackend

__all__ = ["LlamaStackBackend"]
