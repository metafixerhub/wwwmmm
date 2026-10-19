import os
import sys
import socket
import time
import webbrowser
import threading
import uvicorn

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')


def is_port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def find_free_port(start_port: int = 8000) -> int:
    port = start_port
    while is_port_in_use(port) and port < start_port + 50:
        port += 1
    return port


def open_browser(url: str):
    time.sleep(1.2)
    try:
        webbrowser.open(url)
    except Exception:
        pass


def main():
    print("=" * 65)
    print("  ✨ CrystalClear - AI Video Watermark Remover")
    print("  OpenCV Multi-scale Inpainting + FFmpeg High-Efficiency Pipeline")
    print("=" * 65)

    port = find_free_port(8000)
    url = f"http://127.0.0.1:{port}"

    print(f"\n[+] Server launching at: {url}")
    print("[+] Opening your web browser automatically...")
    print("[+] Press Ctrl+C in this terminal window to stop the application.\n")

    # Start browser opener in background thread
    threading.Thread(target=open_browser, args=(url,), daemon=True).start()

    # Start Uvicorn ASGI server
    uvicorn.run("app:app", host="127.0.0.1", port=port, log_level="info")


if __name__ == "__main__":
    main()
