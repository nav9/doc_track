#!/usr/bin/env python3
"""Interactive developer menu for the DocTrack web application."""

from __future__ import annotations

import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NPM = shutil.which("npm")

MENU = """
DocTrack developer menu
-----------------------
1. Build the project
2. Clean and build the project
3. Run the project
4. Run the project with test data
5. Exit
"""


def require_npm() -> bool:
    if NPM:
        return True
    print("npm was not found on PATH. Install Node.js 22 or newer and try again.")
    return False


def clean_build_output() -> None:
    """Remove generated output, including any service worker from older builds."""
    for relative in ("dist", "dev-dist", "node_modules/.vite"):
        path = ROOT / relative
        if path.exists():
            shutil.rmtree(path)
            print(f"Removed {relative}/")


def build_project(clean: bool = False) -> None:
    if not require_npm():
        return
    if clean:
        clean_build_output()
    print("\nBuilding DocTrack...")
    result = subprocess.run([NPM, "run", "build"], cwd=ROOT, check=False)
    if result.returncode == 0:
        print("\nBuild completed successfully. Output is in dist/.")
    else:
        print(f"\nBuild failed with exit code {result.returncode}.")


def stop_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is not None:
        return
    print("\nStopping the development server...")
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGINT)
        else:
            process.terminate()
        process.wait(timeout=10)
    except (ProcessLookupError, subprocess.TimeoutExpired):
        if process.poll() is None:
            process.kill()
            process.wait()


def run_project(with_test_data: bool = False) -> None:
    if not require_npm():
        return

    port = 5174 if with_test_data else 5173
    env = os.environ.copy()
    if with_test_data:
        env["VITE_DOCTRACK_TEST_DATA"] = "true"

    print(f"\nStarting DocTrack at http://127.0.0.1:{port}/")
    if with_test_data:
        print("Test data will be loaded on the first visit to this origin.")
    print("Press Ctrl+C to stop the server and return to the menu.\n")

    command = [NPM, "run", "dev", "--", "--port", str(port), "--strictPort"]
    process = subprocess.Popen(command, cwd=ROOT, env=env, start_new_session=True)
    try:
        process.wait()
    except KeyboardInterrupt:
        stop_server(process)
    print("Development server stopped.")


def main() -> int:
    print(MENU)
    while True:
        try:
            choice = input("Select an option (1-5): ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            return 0

        if choice == "1":
            build_project()
        elif choice == "2":
            build_project(clean=True)
        elif choice == "3":
            run_project()
        elif choice == "4":
            run_project(with_test_data=True)
        elif choice == "5":
            print("Goodbye.")
            return 0
        elif choice:
            print(f"Unknown option: {choice}")

        print(MENU)


if __name__ == "__main__":
    sys.exit(main())