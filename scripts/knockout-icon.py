"""Make the outer black frame of assets/icon.png fully transparent."""
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "assets" / "icon.png"


def is_frame(r, g, b, a, limit=48):
    if a < 8:
        return True
    return r <= limit and g <= limit and b <= limit


def main():
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    px = im.load()
    seen = bytearray(w * h)
    q = deque()

    def idx(x, y):
        return y * w + x

    def push(x, y):
        if 0 <= x < w and 0 <= y < h and not seen[idx(x, y)]:
            r, g, b, a = px[x, y]
            if is_frame(r, g, b, a):
                seen[idx(x, y)] = 1
                q.append((x, y))

    for x in range(w):
        push(x, 0)
        push(x, h - 1)
    for y in range(h):
        push(0, y)
        push(w - 1, y)

    while q:
        x, y = q.popleft()
        px[x, y] = (0, 0, 0, 0)
        push(x - 1, y)
        push(x + 1, y)
        push(x, y - 1)
        push(x, y + 1)

    # Soften the rounded-rect fringe so leftover dark AA does not look like a halo.
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            near = False
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and px[nx, ny][3] == 0:
                    near = True
                    break
            if not near:
                continue
            luma = 0.299 * r + 0.587 * g + 0.114 * b
            if luma < 90:
                px[x, y] = (0, 0, 0, 0)
            elif luma < 170:
                px[x, y] = (r, g, b, int(a * (luma - 90) / 80))

    im.save(SRC)
    print(f"knocked out outer black frame: {SRC} ({w}x{h})")


if __name__ == "__main__":
    main()
