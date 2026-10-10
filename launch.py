"""Open the local interface, reusing an already-running read-only instance."""
import json
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
URL = "http://127.0.0.1:8951"


def ready():
    try:
        result = json.loads(urllib.request.urlopen(URL+"/health", timeout=1).read())
        return result.get("status") == "ready" and result.get("chain_id") == 97 and result.get("execution_enabled") is False
    except (OSError, ValueError):
        return False


if not ready():
    log = (ROOT / ".position-guard-local.log").open("a")
    process = subprocess.Popen([sys.executable, str(ROOT / "server.py"), "--port", "8951"],
                               cwd=str(ROOT), stdin=subprocess.DEVNULL, stdout=log, stderr=log)
    (ROOT / ".position-guard.pid").write_text(str(process.pid)+"\n")
    for _ in range(15):
        if ready():
            break
        time.sleep(0.2)
    else:
        sys.exit("Couldn't start the local interface. See .position-guard-local.log")
print("Position Guard: "+URL)
webbrowser.open(URL)
