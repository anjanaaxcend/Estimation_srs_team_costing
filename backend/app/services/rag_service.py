from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from app.core.config import settings
from app.services.ingestion.file_processor import FileProcessor

logger = logging.getLogger(__name__)

class RAGService:
    def __init__(self) -> None:
        self.file_processor = FileProcessor()
        self._corpus: list[str] = []
        self._initialized = False

    def _chunk_text(self, text: str, chunk_size: int = 200, overlap: int = 50) -> list[str]:
        # Meaningful chunking with a sliding window to maintain context
        words = text.split()
        chunks = []
        step = max(1, chunk_size - overlap)
        for i in range(0, len(words), step):
            chunk = " ".join(words[i : i + chunk_size])
            if chunk:
                chunks.append(chunk)
        return chunks

    def initialize(self) -> None:
        if self._initialized:
            return

        source_paths = settings.rag_source_paths
        for path in source_paths:
            if not path.exists():
                logger.warning(f"RAG source path does not exist: {path}")
                continue
            
            try:
                with path.open("rb") as f:
                    content = self.file_processor.extract_text(path.name, f.read())
                    # Meaningful chunking with overlap for better context retention
                    chunks = self._chunk_text(content, chunk_size=250, overlap=50)
                    self._corpus.extend(chunks)
                logger.info(f"Ingested {len(chunks)} chunks from {path.name}")
            except Exception as e:
                logger.error(f"Failed to ingest {path}: {e}")

        self._initialized = True

    def query(self, query_text: str, top_k: int = 5) -> list[str]:
        if not settings.rag_enabled:
            return []
        
        if not self._initialized:
            self.initialize()

        if not self._corpus:
            return []

        # For a truly agentic experience without a heavy vector DB, 
        # we can use a simple keyword-based relevance ranking or
        # if the corpus is small, just return the most relevant snippets.
        # Since we are in a coding task, I'll implement a basic TF-IDF style 
        # or just keyword matching for now to stay lightweight, 
        # but I will mention we can upgrade to full embeddings.
        
        query_words = set(query_text.lower().split())
        scored_chunks = []
        for chunk in self._corpus:
            chunk_lower = chunk.lower()
            score = sum(1 for word in query_words if word in chunk_lower)
            if score > 0:
                scored_chunks.append((chunk, score))
        
        scored_chunks.sort(key=lambda x: x[1], reverse=True)
        return [chunk for chunk, score in scored_chunks[:top_k]]
