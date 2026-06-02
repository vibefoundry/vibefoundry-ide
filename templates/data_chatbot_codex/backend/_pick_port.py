"""Print two free localhost ports (backend frontend) on one line to stdout.

Both launchers (run_app.sh / run_app.bat) need two ports per launch. Reserving
them in a single interpreter start is faster than spawning python twice, and
holding both sockets open until after both binds guarantees the ports differ.

Standalone .py file (vs. inline `python -c "..."`) so the Windows launcher
avoids CMD single-quote escaping inside `for /f`, which breaks across shell
variants — `for /f "tokens=1,2" %%a in ('python backend\\_pick_port.py')` just
works.
"""
import socket

socks = [socket.socket() for _ in range(2)]
for s in socks:
    s.bind(('127.0.0.1', 0))
print(*(s.getsockname()[1] for s in socks))
for s in socks:
    s.close()
