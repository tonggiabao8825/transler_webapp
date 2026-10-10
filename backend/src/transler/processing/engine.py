"""Subprocess connector with deadline, cooperative cancellation and process-group cleanup."""

import os
import signal
import subprocess

import structlog


def signal_process_group(process_id: int, signal_number: int) -> None:
    try:
        os.killpg(process_id, signal_number)
    except ProcessLookupError:
        structlog.get_logger().debug("processing_group_exited", process_id=process_id)


def stop_process(process: subprocess.Popen[bytes]) -> None:
    signal_process_group(process.pid, signal.SIGTERM)
    if process.poll() is None:
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            signal_process_group(process.pid, signal.SIGKILL)
            process.wait(timeout=3)
    signal_process_group(process.pid, signal.SIGKILL)
