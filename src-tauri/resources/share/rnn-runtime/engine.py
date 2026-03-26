from abc import ABC, abstractmethod
from typing import Dict, Generator, Optional

try:
    import torch
except ImportError:
    torch = None


class InferenceEngine(ABC):
    name: str = "base"
    architecture: str = "unknown"

    def __init__(self):
        self.model = None
        self.model_path: Optional[str] = None
        self.model_name: Optional[str] = None
        self.is_loaded: bool = False
        self.device: str = "cpu"
        self.model_info: Dict[str, object] = {}

    @abstractmethod
    def load(self, model_path: str) -> Dict[str, object]:
        raise NotImplementedError

    @abstractmethod
    def unload(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def generate_stream(
        self,
        prompt: str,
        temperature: float = 1.0,
        top_p: float = 0.7,
        max_tokens: int = 500,
    ) -> Generator[str, None, None]:
        raise NotImplementedError

    @abstractmethod
    def encode(self, text: str) -> list:
        raise NotImplementedError

    @abstractmethod
    def decode(self, tokens: list) -> str:
        raise NotImplementedError

    def reset(self) -> None:
        return None

    @staticmethod
    def detect_device() -> str:
        if torch is None:
            return "cpu"
        if torch.backends.mps.is_available():
            return "mps"
        if torch.cuda.is_available():
            return "cuda"
        return "cpu"
