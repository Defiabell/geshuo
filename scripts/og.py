#!/usr/bin/env python3
"""Render public/og.png (1200x630), the one share card for the whole site.

Everything here is lifted from the site, not invented:
- paper / ink / dust / rule come from src/styles/tokens.css (light theme);
- the wordmark is one character per colour, the four stops of the latitude
  ramp in src/lib/palette.ts (rampStops(4)) -- same OKLCH -> sRGB maths;
- two registration crosses, as on every page's masthead (.sheet .mark);
- Songti SC stands in for Noto Serif SC (its CSS fallback), Hiragino Sans GB
  for the UI face.
No overprint / misregistration effect on purpose: AGENTS.md rule 21.

Run from the repo root: python3 scripts/og.py
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "og.png"

W, H = 1200, 630
PAPER, INK, INK2, DUST, RULE = "#EFEDE6", "#1A1714", "#5C554B", "#9C948A", "#DCD7CB"

SERIF = "/System/Library/Fonts/Supplemental/Songti.ttc"  # index 1 = Songti SC Bold
SANS = "/System/Library/Fonts/Hiragino Sans GB.ttc"  # index 0 = W3

WORDMARK = "各说各话"
TAGLINE = "同一出戏，各地各演一遍。"
DOMAIN = "geshuo.defiabell.com"

# --- palette.ts, verbatim -------------------------------------------------
HUE_PATH = [243.1, 269.5, 329.3, 386.8, 403.5]
BASE_CHROMA = 0.095
L_TEXT = 0.42


def hue_at(t: float) -> float:
    x = min(max(t, 0.0), 1.0) * (len(HUE_PATH) - 1)
    i = min(math.floor(x), len(HUE_PATH) - 2)
    return (HUE_PATH[i] + (HUE_PATH[i + 1] - HUE_PATH[i]) * (x - i)) % 360


def oklch_to_rgb(l: float, c: float, h: float) -> tuple[int, int, int]:
    """OKLCH -> sRGB 8-bit, Bjorn Ottosson's reference transform."""
    a = c * math.cos(math.radians(h))
    b = c * math.sin(math.radians(h))
    l_ = l + 0.3963377774 * a + 0.2158037573 * b
    m_ = l - 0.1055613458 * a - 0.0638541728 * b
    s_ = l - 0.0894841775 * a - 1.2914855480 * b
    l3, m3, s3 = l_**3, m_**3, s_**3
    r = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3
    g = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3
    bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3

    def gamma(v: float) -> int:
        v = min(max(v, 0.0), 1.0)
        v = 1.055 * v ** (1 / 2.4) - 0.055 if v > 0.0031308 else 12.92 * v
        return round(v * 255)

    return gamma(r), gamma(g), gamma(bl)


def ramp_stops(n: int) -> list[tuple[int, int, int]]:
    return [oklch_to_rgb(L_TEXT, BASE_CHROMA, hue_at(i / (n - 1))) for i in range(n)]


def cross(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int = 9) -> None:
    d.line([(cx - r, cy), (cx + r, cy)], fill=RULE, width=2)
    d.line([(cx, cy - r), (cx, cy + r)], fill=RULE, width=2)


def main() -> None:
    img = Image.new("RGB", (W, H), PAPER)
    d = ImageDraw.Draw(img)

    margin = 84
    cross(d, margin, margin)
    cross(d, W - margin, margin)
    cross(d, margin, H - margin)
    cross(d, W - margin, H - margin)

    # wordmark: one character, one ramp stop, north -> south
    wm_font = ImageFont.truetype(SERIF, 200, index=1)
    inks = ramp_stops(len(WORDMARK))
    gap = 18
    widths = [d.textlength(ch, font=wm_font) for ch in WORDMARK]
    total = sum(widths) + gap * (len(WORDMARK) - 1)
    x = (W - total) / 2
    y = 150
    for ch, w, ink in zip(WORDMARK, widths, inks):
        d.text((x, y), ch, font=wm_font, fill=ink)
        x += w + gap

    tag_font = ImageFont.truetype(SERIF, 46, index=1)
    tw = d.textlength(TAGLINE, font=tag_font)
    d.text(((W - tw) / 2, y + 200 + 54), TAGLINE, font=tag_font, fill=INK2)

    dom_font = ImageFont.truetype(SANS, 26, index=0)
    spacing = 2
    dw = sum(d.textlength(ch, font=dom_font) + spacing for ch in DOMAIN) - spacing
    x = (W - dw) / 2
    yd = H - margin - 13
    for ch in DOMAIN:
        d.text((x, yd), ch, font=dom_font, fill=DUST)
        x += d.textlength(ch, font=dom_font) + spacing

    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
