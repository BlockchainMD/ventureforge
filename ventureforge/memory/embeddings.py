"""Vector embeddings for semantic search (optional)."""

from __future__ import annotations

from ventureforge.utils.logger import get_logger

logger = get_logger()


class EmbeddingStore:
    """Optional embedding-based semantic search.

    Requires the 'embeddings' extra: pip install ventureforge[embeddings]
    """

    def __init__(self) -> None:
        self._model = None
        self._available = False
        try:
            from sentence_transformers import SentenceTransformer

            self._model = SentenceTransformer("all-MiniLM-L6-v2")
            self._available = True
        except ImportError:
            logger.debug("embeddings_unavailable", reason="sentence-transformers not installed")

    @property
    def available(self) -> bool:
        """Whether embedding support is available."""
        return self._available

    def embed(self, text: str) -> list[float]:
        """Generate embedding for a text string."""
        if not self._available or self._model is None:
            return []
        return self._model.encode(text).tolist()

    def similarity(self, text_a: str, text_b: str) -> float:
        """Compute cosine similarity between two texts."""
        if not self._available:
            return 0.0
        from sentence_transformers import util

        emb_a = self._model.encode(text_a)
        emb_b = self._model.encode(text_b)
        return float(util.cos_sim(emb_a, emb_b)[0][0])
