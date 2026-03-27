import shutil
from abc import ABC, abstractmethod
from importlib.util import find_spec
from pathlib import Path
import os
from typing import Any, Dict, Generator, Optional

try:
    import torch
except ImportError:
    torch = None


RUNTIME_DIR = Path(__file__).resolve().parent
ALBATROSS_REFERENCE_DIR = RUNTIME_DIR / "albatross_reference"


def _bundled_albatross_source_available() -> bool:
    return (
        (ALBATROSS_REFERENCE_DIR / "__init__.py").exists()
        and (ALBATROSS_REFERENCE_DIR / "rwkv7.py").exists()
        and (ALBATROSS_REFERENCE_DIR / "utils.py").exists()
        and (ALBATROSS_REFERENCE_DIR / "cuda" / "rwkv7_state_fwd_fp16.cpp").exists()
        and (ALBATROSS_REFERENCE_DIR / "cuda" / "rwkv7_state_fwd_fp16.cu").exists()
    )


def _resolve_nvcc_path() -> Optional[str]:
    path = shutil.which("nvcc")
    if path:
        return path
    cuda_home = os.environ.get("CUDA_HOME") or os.environ.get("CUDA_PATH")
    if cuda_home:
        candidate = Path(cuda_home) / "bin" / "nvcc"
        if candidate.exists():
            return str(candidate)
    fallback = Path("/usr/local/cuda/bin/nvcc")
    if fallback.exists():
        return str(fallback)
    return None


def detect_runtime_capabilities() -> Dict[str, Any]:
    transformers_available = find_spec("transformers") is not None
    vllm_available = find_spec("vllm") is not None
    llama_cpp_available = find_spec("llama_cpp") is not None
    nvcc_path = _resolve_nvcc_path()
    bundled_albatross = _bundled_albatross_source_available()
    payload: Dict[str, Any] = {
        "torchAvailable": torch is not None,
        "torchVersion": getattr(torch, "__version__", None) if torch is not None else None,
        "cudaAvailable": False,
        "cudaDeviceCount": 0,
        "cudaDeviceName": None,
        "mpsAvailable": False,
        "preferredDevice": "cpu",
        "nvccPath": nvcc_path,
        "albatrossSourceBundled": bundled_albatross,
        "currentProcessCudaAllocatedMiB": 0.0,
        "currentProcessCudaReservedMiB": 0.0,
    }
    if torch is None:
        payload["backendAvailability"] = {
            "rwkv": False,
            "mamba": False,
            "huggingface": False,
            "vllm": vllm_available,
            "llama-cpp": llama_cpp_available,
            "albatross": False,
        }
        payload["supportedBackends"] = [
            name
            for name, available in payload["backendAvailability"].items()
            if available
        ]
        return payload

    try:
        payload["mpsAvailable"] = bool(torch.backends.mps.is_available())
    except Exception:
        payload["mpsAvailable"] = False

    try:
        payload["cudaAvailable"] = bool(torch.cuda.is_available())
    except Exception:
        payload["cudaAvailable"] = False

    if payload["cudaAvailable"]:
        try:
            payload["cudaDeviceCount"] = int(torch.cuda.device_count())
        except Exception:
            payload["cudaDeviceCount"] = 0
        if payload["cudaDeviceCount"] > 0:
            try:
                payload["cudaDeviceName"] = str(torch.cuda.get_device_name(0))
            except Exception:
                payload["cudaDeviceName"] = None
        try:
            payload["currentProcessCudaAllocatedMiB"] = round(
                torch.cuda.memory_allocated() / 1024**2, 1
            )
        except Exception:
            payload["currentProcessCudaAllocatedMiB"] = 0.0
        try:
            payload["currentProcessCudaReservedMiB"] = round(
                torch.cuda.memory_reserved() / 1024**2, 1
            )
        except Exception:
            payload["currentProcessCudaReservedMiB"] = 0.0

    payload["preferredDevice"] = (
        "mps"
        if payload["mpsAvailable"]
        else "cuda"
        if payload["cudaAvailable"]
        else "cpu"
    )

    backend_availability = {
        "rwkv": True,
        "mamba": transformers_available,
        "huggingface": transformers_available,
        "vllm": vllm_available,
        "llama-cpp": llama_cpp_available,
        "albatross": bool(payload["cudaAvailable"] and bundled_albatross and nvcc_path),
    }
    payload["backendAvailability"] = backend_availability
    payload["supportedBackends"] = [
        name for name, available in backend_availability.items() if available
    ]
    return payload


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
        self.last_generation_stats: Dict[str, object] = {}

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
