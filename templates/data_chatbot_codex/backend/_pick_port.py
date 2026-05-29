"""Print one free localhost port to stdout.

Helper for the Windows launcher: invoking inline `python -c "..."` from a
.bat file forces unreliable single-quote escapes inside `for /f`, which
breaks on multiple Windows shell variants. A standalone .py file removes
all CMD quoting entirely — `for /f %%p in ('python backend\\_pick_port.py')`
just works.
"""
import socket

s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
