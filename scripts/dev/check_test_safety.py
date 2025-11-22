#!/usr/bin/env python3
"""
Check for dangerous test configuration that could cost money.

Run this before executing tests to ensure you won't accidentally
hit live APIs and rack up bills.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def check_env_file() -> list[str]:
    """Check .env file for dangerous settings."""
    warnings = []
    env_file = Path(".env")
    
    if not env_file.exists():
        return warnings
    
    content = env_file.read_text()
    lines = content.split("\n")
    
    for line_num, line in enumerate(lines, 1):
        line = line.strip()
        
        # Skip comments and empty lines
        if not line or line.startswith("#"):
            continue
        
        # Check for dangerous PROVIDERS_MODE=live
        if "PROVIDERS_MODE" in line and "live" in line.lower():
            if not line.startswith("#"):
                warnings.append(
                    f"⚠️  Line {line_num} in .env: {line}\n"
                    f"   This will cause tests to hit LIVE APIs and cost real money!"
                )
    
    return warnings


def check_environment() -> list[str]:
    """Check environment variables for dangerous settings."""
    warnings = []
    
    providers_mode = os.getenv("PROVIDERS_MODE", "").lower()
    if providers_mode == "live":
        warnings.append(
            "⚠️  Environment variable PROVIDERS_MODE=live is set!\n"
            "   Tests will hit LIVE APIs and cost real money.\n"
            "   Unset it: unset PROVIDERS_MODE"
        )
    
    return warnings


def main() -> int:
    """Run all safety checks."""
    print("🔍 Checking test safety configuration...")
    print()
    
    all_warnings: list[str] = []
    
    # Check .env file
    env_warnings = check_env_file()
    if env_warnings:
        print("📄 .env File Issues:")
        for warning in env_warnings:
            print(warning)
        print()
        all_warnings.extend(env_warnings)
    
    # Check environment
    env_var_warnings = check_environment()
    if env_var_warnings:
        print("🌍 Environment Variable Issues:")
        for warning in env_var_warnings:
            print(warning)
        print()
        all_warnings.extend(env_var_warnings)
    
    if all_warnings:
        print("=" * 70)
        print("🚨 DANGER: Unsafe test configuration detected!")
        print("=" * 70)
        print()
        print("If you run tests now, they will:")
        print("  • Hit live kie.ai APIs (~$50+ per full test run)")
        print("  • Hit live Shotstack APIs (costs per render)")
        print("  • Hit live upload-post APIs")
        print()
        print("To fix:")
        print("  1. Remove PROVIDERS_MODE=live from .env file")
        print("  2. Unset PROVIDERS_MODE in your shell: unset PROVIDERS_MODE")
        print("  3. Run tests with: make test (enforces mock mode)")
        print()
        print("Tests are automatically mocked via conftest.py fixtures.")
        print("You don't need to set PROVIDERS_MODE=mock explicitly.")
        print()
        return 1
    
    print("✅ Safe configuration detected")
    print("   PROVIDERS_MODE is not set to 'live'")
    print("   Tests will use mock providers (free, fast, offline)")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())

