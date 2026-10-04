from __future__ import annotations

import ctypes
import os
import platform
import shutil
import socket
import subprocess
from pathlib import Path
from typing import Any


def _memory_mib() -> tuple[int, int]:
    if os.name == "nt":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("length", ctypes.c_ulong),
                ("memory_load", ctypes.c_ulong),
                ("total_phys", ctypes.c_ulonglong),
                ("avail_phys", ctypes.c_ulonglong),
                ("total_page_file", ctypes.c_ulonglong),
                ("avail_page_file", ctypes.c_ulonglong),
                ("total_virtual", ctypes.c_ulonglong),
                ("avail_virtual", ctypes.c_ulonglong),
                ("avail_extended_virtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatus()
        status.length = ctypes.sizeof(MemoryStatus)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return status.total_phys // (1024 * 1024), status.avail_phys // (1024 * 1024)
        return 0, 0
    try:
        page_size = os.sysconf("SC_PAGE_SIZE")
        total_pages = os.sysconf("SC_PHYS_PAGES")
        available_pages = os.sysconf("SC_AVPHYS_PAGES")
        return (page_size * total_pages) // (1024 * 1024), (page_size * available_pages) // (1024 * 1024)
    except (AttributeError, OSError, ValueError):
        return 0, 0


def _nvidia_gpus() -> tuple[list[dict[str, Any]], str | None]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return [], None
    command = [
        executable,
        "--query-gpu=index,name,memory.total,memory.free,temperature.gpu,driver_version",
        "--format=csv,noheader,nounits",
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=15, check=True)
    except (OSError, subprocess.SubprocessError):
        return [], None
    result: list[dict[str, Any]] = []
    driver: str | None = None
    for line in completed.stdout.splitlines():
        fields = [field.strip() for field in line.split(",")]
        if len(fields) < 6:
            continue
        index, name, total, free, temperature, driver_value = fields[:6]
        driver = driver or driver_value
        result.append({
            "index": int(index),
            "name": name,
            "vramTotalMiB": int(total),
            "vramFreeMiB": int(free),
            "temperatureC": None if temperature in {"N/A", "[N/A]"} else int(temperature),
            "driverVersion": driver_value,
        })
    return result, driver


def discover_hardware(node_id: str, *, data_root: Path) -> dict[str, Any]:
    data_root.mkdir(parents=True, exist_ok=True)
    total_ram, free_ram = _memory_mib()
    disk = shutil.disk_usage(data_root)
    gpus, driver = _nvidia_gpus()
    return {
        "schemaVersion": "hardware-profile/v1",
        "nodeId": node_id,
        "hostname": socket.gethostname(),
        "os": f"{platform.system()} {platform.release()}",
        "architecture": platform.machine(),
        "cpu": platform.processor() or platform.machine(),
        "cpuLogicalCores": os.cpu_count() or 0,
        "ramTotalMiB": int(total_ram),
        "ramFreeMiB": int(free_ram),
        "diskFreeMiB": int(disk.free // (1024 * 1024)),
        "gpus": gpus,
        "cudaAvailable": bool(gpus),
        "nvidiaDriver": driver,
    }
