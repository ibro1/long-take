"""
Does SRT answer on 8890?

An SRT caller opens with an induction handshake, and a listener must reply with
a version-5 handshake carrying a cookie. Sending one is the only honest way to
tell a reachable UDP port from a silent one - nothing else about UDP gives an
answer either way.
"""
import socket, struct, sys, time

host, port = "framevane-live.linkfa.de", 8890
addr = socket.gethostbyname(host)
print(f"{host} -> {addr}:{port}")

# Control packet header: F=1 + type HANDSHAKE(0), subtype 0, additional 0,
# timestamp, destination socket id 0.
header = struct.pack(">HHIII", 0x8000, 0x0000, 0, int(time.time() * 1_000_000) & 0xFFFFFFFF, 0)
# Handshake body: version 4, no encryption, extension 2, seq, MSS, window,
# request type 1 (INDUCTION), our socket id, cookie 0, peer IP.
body = struct.pack(">IHHIIIIII", 4, 0, 2, 0, 1500, 8192, 1, 0x5A5A5A5A, 0) + b"\x00" * 16

s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.settimeout(4)
s.sendto(header + body, (addr, port))
try:
    data, who = s.recvfrom(2048)
except socket.timeout:
    print("NO REPLY in 4s - the port is filtered, or nothing is listening")
    sys.exit(1)

version = struct.unpack(">I", data[16:20])[0]
req = struct.unpack(">i", data[32:36])[0]
cookie = struct.unpack(">I", data[40:44])[0]
print(f"REPLY from {who[0]}:{who[1]} - {len(data)} bytes")
print(f"  handshake version {version}, request type {req}, cookie 0x{cookie:08x}")
print("\nSRT IS REACHABLE: the listener answered the induction handshake.")
