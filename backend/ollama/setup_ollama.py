#!/usr/bin/env python3
"""
ScopeSense AI — Ollama Model Setup & Fine-Tuning Script
========================================================
This script does NOT retrain a model from scratch.
Instead it:
  1. Verifies Ollama is running
  2. Pulls the base model (mistral / llama3.1)
  3. Creates a custom 'scopesense-srs' model from the Modelfile
     (bakes in domain-expert system prompt + optimized parameters)
  4. Runs a quick validation inference to confirm the model works
  5. Updates the .env to use the new model

Usage:
    python backend/ollama/setup_ollama.py
    python backend/ollama/setup_ollama.py --base-model llama3.1:8b
    python backend/ollama/setup_ollama.py --skip-pull   (if model already downloaded)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────
OLLAMA_HOST = os.getenv("OLLAMA_API_BASE", "http://localhost:11434").replace("/v1", "")
MODELFILE_PATH = Path(__file__).parent / "Modelfile"
CUSTOM_MODEL_NAME = "scopesense-srs"
DEFAULT_BASE_MODEL = "mistral"
ENV_PATH = Path(__file__).resolve().parents[2] / ".env"

# ── Validation prompt ──────────────────────────────────────────────────────
VALIDATION_PROMPT = """
You are ScopeSense. Generate a minimal SRS JSON for a simple Todo app.
Return ONLY valid JSON with this structure:
{
  "sections": [
    {"title": "1. Introduction", "body": "A simple todo list application..."},
    {"title": "2. Features", "body": "- Add tasks\\n- Mark complete\\n- Delete tasks"}
  ],
  "delivery_plan": {
    "modules": [{"module_name": "Core", "features": ["Tasks"], "total_days": 5, "testing_days": 1, "start_week": 0, "end_week": 1}],
    "recommended_team": {"lead_count": 1, "mid_count": 1, "junior_count": 0, "tester_count": 1, "devops_count": 0, "ui_ux_count": 0},
    "total_duration_days": 5
  }
}
"""


def run(cmd: list[str], check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    """Run a shell command."""
    print(f"  → {' '.join(cmd)}")
    return subprocess.run(
        cmd,
        check=check,
        capture_output=capture,
        text=True,
    )


def check_ollama_running() -> bool:
    """Check if Ollama server is accessible."""
    try:
        import urllib.request
        req = urllib.request.urlopen(f"{OLLAMA_HOST}/api/tags", timeout=5)
        return req.status == 200
    except Exception:
        return False


def pull_base_model(base_model: str) -> None:
    """Pull the base model from Ollama registry."""
    print(f"\n📥 Pulling base model: {base_model}")
    print("   This may take a while depending on your internet speed...")
    run(["ollama", "pull", base_model])
    print(f"   ✅ Base model '{base_model}' ready")


def patch_modelfile(base_model: str) -> None:
    """Patch the Modelfile to use the chosen base model."""
    content = MODELFILE_PATH.read_text(encoding="utf-8")
    lines = content.splitlines()
    patched = []
    found_from = False
    for line in lines:
        if line.startswith("FROM ") and not found_from:
            patched.append(f"FROM {base_model}")
            found_from = True
        elif line.startswith("# FROM ") or (line.startswith("FROM ") and found_from):
            patched.append(f"# FROM {line.lstrip('# FROM').strip()}")
        else:
            patched.append(line)
    MODELFILE_PATH.write_text("\n".join(patched), encoding="utf-8")
    print(f"   📝 Modelfile patched to use base: {base_model}")


def create_custom_model() -> None:
    """Build the custom ScopeSense model from the Modelfile."""
    print(f"\n🔨 Creating custom model: {CUSTOM_MODEL_NAME}")
    run(["ollama", "create", CUSTOM_MODEL_NAME, "-f", str(MODELFILE_PATH)])
    print(f"   ✅ Model '{CUSTOM_MODEL_NAME}' created successfully")


def validate_model() -> bool:
    """Run a quick inference to confirm the model outputs valid JSON."""
    print(f"\n🧪 Validating model '{CUSTOM_MODEL_NAME}' with test inference...")
    try:
        import urllib.request, urllib.error
        payload = json.dumps({
            "model": CUSTOM_MODEL_NAME,
            "prompt": VALIDATION_PROMPT,
            "stream": False,
            "format": "json",
            "options": {"temperature": 0.1, "num_ctx": 2048}
        }).encode()

        req = urllib.request.Request(
            f"{OLLAMA_HOST}/api/generate",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            response_text = result.get("response", "")
            # Strip markdown fences if present
            import re
            clean = re.sub(r'^```(?:json)?\s*', '', response_text.strip(), flags=re.IGNORECASE)
            clean = re.sub(r'```\s*$', '', clean.strip())
            parsed = json.loads(clean)
            assert "sections" in parsed, "No 'sections' key in response"
            assert "delivery_plan" in parsed, "No 'delivery_plan' key in response"
            print("   ✅ Model outputs valid JSON with correct structure!")
            print(f"   📄 Sample section: {parsed['sections'][0]['title']}")
            return True
    except Exception as e:
        print(f"   ⚠️  Validation warning: {e}")
        print("   The model was created but validation inference failed.")
        print("   This can happen if Ollama is slow — try generating an SRS to confirm.")
        return False


def update_env(model_name: str) -> None:
    """Update the .env file to use the new custom model."""
    if not ENV_PATH.exists():
        print(f"   ⚠️  .env not found at {ENV_PATH} — skipping env update")
        return

    content = ENV_PATH.read_text(encoding="utf-8")
    lines = content.splitlines()
    updated = []
    found = False
    for line in lines:
        if line.startswith("OLLAMA_SRS_MODEL="):
            updated.append(f"OLLAMA_SRS_MODEL={model_name}")
            found = True
        else:
            updated.append(line)
    if not found:
        updated.append(f"OLLAMA_SRS_MODEL={model_name}")

    ENV_PATH.write_text("\n".join(updated), encoding="utf-8")
    print(f"   ✅ .env updated: OLLAMA_SRS_MODEL={model_name}")


def list_models() -> None:
    """List all available Ollama models."""
    print("\n📋 Available Ollama models:")
    run(["ollama", "list"], check=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="ScopeSense Ollama Setup Script")
    parser.add_argument("--base-model", default=DEFAULT_BASE_MODEL,
                        help=f"Base model to use (default: {DEFAULT_BASE_MODEL}). Options: mistral, llama3.1:8b, llama3.1:70b, codellama:13b, deepseek-r1:8b")
    parser.add_argument("--skip-pull", action="store_true",
                        help="Skip pulling the base model (use if already downloaded)")
    parser.add_argument("--skip-validate", action="store_true",
                        help="Skip validation inference after creating the model")
    parser.add_argument("--list", action="store_true",
                        help="List all available Ollama models and exit")
    args = parser.parse_args()

    print("=" * 60)
    print("  ScopeSense AI — Ollama Model Setup")
    print("=" * 60)

    if args.list:
        list_models()
        return

    # 1. Check Ollama is running
    print("\n🔍 Checking Ollama server...")
    if not check_ollama_running():
        print("   ❌ Ollama is not running!")
        print("   Please start it with: ollama serve")
        print("   Then run this script again.")
        sys.exit(1)
    print(f"   ✅ Ollama is running at {OLLAMA_HOST}")

    # 2. Pull base model
    if not args.skip_pull:
        pull_base_model(args.base_model)
    else:
        print(f"\n⏭️  Skipping pull — using existing '{args.base_model}'")

    # 3. Patch and create custom model
    patch_modelfile(args.base_model)
    create_custom_model()

    # 4. Validate
    if not args.skip_validate:
        validate_model()
    else:
        print("\n⏭️  Skipping validation")

    # 5. Update .env
    print("\n📝 Updating .env configuration...")
    update_env(CUSTOM_MODEL_NAME)

    # 6. List all models
    list_models()

    print("\n" + "=" * 60)
    print("  🎉 Setup complete!")
    print(f"  Custom model: {CUSTOM_MODEL_NAME}")
    print(f"  Base model:   {args.base_model}")
    print("")
    print("  Restart the backend to pick up the new .env:")
    print("    npm run dev:backend")
    print("")
    print("  In the ScopeSense UI, select 'Ollama (Local)' as the AI engine.")
    print("=" * 60)


if __name__ == "__main__":
    main()
