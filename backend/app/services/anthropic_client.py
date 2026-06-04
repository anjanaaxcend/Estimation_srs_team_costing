from __future__ import annotations

import logging
from typing import Any
import httpx

logger = logging.getLogger(__name__)


class AnthropicChatCompletions:
    def __init__(self, api_key: str, base_url: str | None = None, timeout: float = 60.0):
        self.api_key = api_key
        # Default to official Anthropic endpoint if none provided
        self.base_url = (base_url or "https://api.anthropic.com").rstrip("/")
        self.timeout = timeout

    def create(self, **kwargs) -> Any:
        model = kwargs.get("model") or "claude-3-5-sonnet-latest"
        messages = kwargs.get("messages", [])
        temperature = kwargs.get("temperature", 1.0)
        max_tokens = kwargs.get("max_tokens", 4000)

        # Extract system prompt from system role (Anthropic expects it as a top-level parameter)
        system_content = None
        user_assistant_messages = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content")
            if role == "system":
                system_content = content
            else:
                user_assistant_messages.append({"role": role, "content": content})

        # Build payloads
        payload = {
            "model": model,
            "messages": user_assistant_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if system_content:
            payload["system"] = system_content

        # Build headers
        headers = {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

        # Resolve request URL
        if "messages" in self.base_url:
            url = self.base_url
        elif "/v1" in self.base_url:
            url = f"{self.base_url}/messages"
        else:
            url = f"{self.base_url}/v1/messages"

        # Make request using httpx
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(url, json=payload, headers=headers)
                if resp.status_code != 200:
                    error_detail = resp.text
                    try:
                        err_json = resp.json()
                        if "error" in err_json and "message" in err_json["error"]:
                            error_detail = err_json["error"]["message"]
                    except Exception:
                        pass
                    raise RuntimeError(f"Anthropic API error {resp.status_code}: {error_detail}")
                
                data = resp.json()
                content_blocks = data.get("content", [])
                text_response = ""
                for block in content_blocks:
                    if block.get("type") == "text":
                        text_response += block.get("text", "")
                
                # Mock class structure representing standard OpenAI SDK response format
                class Message:
                    def __init__(self, text: str):
                        self.content = text

                class Choice:
                    def __init__(self, text: str):
                        self.message = Message(text)

                class ChatCompletionResponse:
                    def __init__(self, text: str):
                        self.choices = [Choice(text)]

                return ChatCompletionResponse(text_response)
        except httpx.RequestError as exc:
            raise RuntimeError(f"Could not connect to the Anthropic API endpoint: {exc}") from exc


class AnthropicClientShim:
    def __init__(self, api_key: str, base_url: str | None = None, timeout: float = 60.0):
        self.chat = type(
            "ChatShim",
            (),
            {"completions": AnthropicChatCompletions(api_key, base_url, timeout)},
        )()
