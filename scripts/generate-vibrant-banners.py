#!/usr/bin/env python3
"""
Generate vibrant, high-aesthetic X banners (1500x500) that look world-class.
No dark voids. Rich light, vibrant gradients, modern tech-founder aesthetic.
"""
import os
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1500, 500
SCALE = 2
SW, SH = W * SCALE, H * SCALE

FONTS = {
    'black': '/usr/share/fonts/truetype/inter/Inter-Black.ttf',
    'bold': '/usr/share/fonts/truetype/inter/Inter-Bold.ttf',
    'semibold': '/usr/share/fonts/truetype/inter/Inter-SemiBold.ttf',
    'medium': '/usr/share/fonts/truetype/inter/Inter-Medium.ttf',
    'regular': '/usr/share/fonts/truetype/inter/Inter-Regular.ttf',
}

def font(style, size):
    path = FONTS.get(style, FONTS['regular'])
    if not os.path.exists(path):
        return ImageFont.load_default()
    return ImageFont.truetype(path, int(size * SCALE))

# -------------------------------------------------------------
# 1. LUMINOUS HORIZON (Linear / Raycast aesthetic)
# Deep rich twilight indigo -> brilliant glowing amber / coral aurora wave
# -------------------------------------------------------------
def make_luminous_horizon(out_path):
    # Coordinate grid
    x = np.linspace(0, 1, SW)
    y = np.linspace(0, 1, SH)
    xx, yy = np.meshgrid(x, y)

    # Base background: deep rich twilight indigo (not pitch black!)
    # Top: (20, 24, 48), Bottom: (12, 14, 30)
    r = 20 * (1 - yy) + 12 * yy
    g = 24 * (1 - yy) + 14 * yy
    b = 48 * (1 - yy) + 30 * yy

    # Aurora light wave 1: Warm amber/gold glow from mid-bottom right
    # Center around (0.75, 0.45)
    dist1 = np.sqrt(((xx - 0.72) * 1.5)**2 + ((yy - 0.42) * 2.5)**2)
    glow1 = np.exp(-dist1 * 3.2) # Amber/orange bloom
    r += glow1 * 245
    g += glow1 * 158
    b += glow1 * 11

    # Light wave 2: Radiant violet / magenta highlight to bridge the colors
    dist2 = np.sqrt(((xx - 0.55) * 1.8)**2 + ((yy - 0.25) * 3.0)**2)
    glow2 = np.exp(-dist2 * 4.0)
    r += glow2 * 180
    g += glow2 * 70
    b += glow2 * 230

    # Light wave 3: Core intense golden crest
    dist3 = np.sqrt(((xx - 0.78) * 2.2)**2 + ((yy - 0.48) * 4.0)**2)
    glow3 = np.exp(-dist3 * 6.0)
    r += glow3 * 255
    g += glow3 * 220
    b += glow3 * 120

    # Clip values
    rgb = np.stack([
        np.clip(r, 0, 255).astype(np.uint8),
        np.clip(g, 0, 255).astype(np.uint8),
        np.clip(b, 0, 255).astype(np.uint8),
        np.full((SH, SW), 255, dtype=np.uint8)
    ], axis=-1)

    img = Image.fromarray(rgb, "RGBA")

    # Add geometric wave lines / topography (modern sleek contour)
    overlay = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d_over = ImageDraw.Draw(overlay)

    # Draw smooth mathematical wave ribbons
    for i in range(12):
        pts = []
        offset = i * 22 * SCALE
        alpha = int(45 + i * 12)
        color = (255, 230, 180, min(alpha, 140))
        for px in range(0, SW, 8 * SCALE):
            norm_x = px / SW
            # Wave shape rising toward the right
            wave_y = int(SH * 0.72 - math.sin(norm_x * math.pi * 1.2 + i * 0.15) * (140 * SCALE) - (norm_x**2) * (100 * SCALE) + offset)
            pts.append((px, wave_y))
        for j in range(len(pts) - 1):
            d_over.line([pts[j], pts[j+1]], fill=color, width=int(1.8 * SCALE))

    # Add subtle glowing stars / spark nodes in the upper atmosphere
    np.random.seed(42)
    for _ in range(40):
        sx = int(np.random.uniform(SW * 0.4, SW * 0.95))
        sy = int(np.random.uniform(SH * 0.08, SH * 0.6))
        s_rad = np.random.uniform(1.0, 2.5) * SCALE
        s_alpha = int(np.random.uniform(80, 200))
        d_over.ellipse([sx - s_rad, sy - s_rad, sx + s_rad, sy + s_rad], fill=(255, 255, 255, s_alpha))

    img = Image.alpha_composite(img, overlay)

    # Add subtle typography / statement if desired: Minimalist, clean, top right
    draw = ImageDraw.Draw(img)
    
    # Modern tag
    f_tag = font('bold', 12)
    f_sub = font('medium', 14)
    # Right-aligned aesthetic statement
    motto = "BUILDING AT THE INTERSECTION OF MOBILE & AI"
    bbox = f_tag.getbbox(motto)
    mw = bbox[2] - bbox[0]
    tx = SW - int(100 * SCALE) - mw
    ty = int(60 * SCALE)
    
    # Soft frosted background pill for motto
    draw.rounded_rectangle([tx - 16*SCALE, ty - 8*SCALE, tx + mw + 16*SCALE, ty + 24*SCALE], radius=14*SCALE, fill=(255, 255, 255, 20), outline=(255, 255, 255, 40), width=1*SCALE)
    draw.text((tx, ty), motto, font=f_tag, fill=(255, 255, 255, 240))

    # Ventures signature
    v_text = "FrontStaff.ai  •  Long Take"
    v_bbox = f_sub.getbbox(v_text)
    vw = v_bbox[2] - v_bbox[0]
    draw.text((SW - int(100 * SCALE) - vw, ty + 42 * SCALE), v_text, font=f_sub, fill=(251, 191, 36, 230))

    res = img.resize((W, H), Image.Resampling.LANCZOS)
    res.save(out_path, "PNG", optimize=True)
    print("Saved:", out_path)

# -------------------------------------------------------------
# 2. CYBERNETIC COBALT & NEON (AI Systems & Intelligent Networks)
# Vibrant electric cobalt, cyan, and violet rays
# -------------------------------------------------------------
def make_electric_network(out_path):
    x = np.linspace(0, 1, SW)
    y = np.linspace(0, 1, SH)
    xx, yy = np.meshgrid(x, y)

    # Base: Rich Deep Navy Blue (0x0F, 0x17, 0x2A - Tailwind Slate 900)
    r = 15 * (1 - yy) + 10 * yy
    g = 23 * (1 - yy) + 16 * yy
    b = 42 * (1 - yy) + 32 * yy

    # Vibrant Cyan/Teal glow on right
    dist1 = np.sqrt(((xx - 0.75) * 1.4)**2 + ((yy - 0.5) * 2.2)**2)
    glow1 = np.exp(-dist1 * 2.8)
    r += glow1 * 14
    g += glow1 * 165
    b += glow1 * 233

    # Electric Violet accent top center
    dist2 = np.sqrt(((xx - 0.5) * 1.6)**2 + ((yy - 0.2) * 3.0)**2)
    glow2 = np.exp(-dist2 * 3.5)
    r += glow2 * 139
    g += glow2 * 92
    b += glow2 * 246

    # Bright core
    dist3 = np.sqrt(((xx - 0.8) * 2.0)**2 + ((yy - 0.5) * 3.5)**2)
    glow3 = np.exp(-dist3 * 5.0)
    r += glow3 * 120
    g += glow3 * 240
    b += glow3 * 255

    rgb = np.stack([
        np.clip(r, 0, 255).astype(np.uint8),
        np.clip(g, 0, 255).astype(np.uint8),
        np.clip(b, 0, 255).astype(np.uint8),
        np.full((SH, SW), 255, dtype=np.uint8)
    ], axis=-1)

    img = Image.fromarray(rgb, "RGBA")

    # Neural network nodes & constellation lines
    net = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d_net = ImageDraw.Draw(net)

    np.random.seed(101)
    nodes = []
    # Cluster nodes in the right 60% of the canvas
    for _ in range(28):
        nx = int(np.random.uniform(SW * 0.45, SW * 0.92))
        ny = int(np.random.uniform(SH * 0.15, SH * 0.85))
        nodes.append((nx, ny))

    # Connect nearby nodes
    for i in range(len(nodes)):
        for j in range(i + 1, len(nodes)):
            d = math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1])
            if d < 180 * SCALE:
                alpha = int((1 - d / (180 * SCALE)) * 120)
                d_net.line([nodes[i], nodes[j]], fill=(140, 215, 255, alpha), width=int(1.2 * SCALE))

    # Draw nodes
    for nx, ny in nodes:
        rad = np.random.uniform(3, 6) * SCALE
        d_net.ellipse([nx - rad, ny - rad, nx + rad, ny + rad], fill=(255, 255, 255, 220))
        # Halo
        d_net.ellipse([nx - rad*2.2, ny - rad*2.2, nx + rad*2.2, ny + rad*2.2], fill=(56, 189, 248, 60))

    img = Image.alpha_composite(img, net)

    # Sleek branding block on top
    draw = ImageDraw.Draw(img)
    f_tag = font('bold', 12)
    f_sub = font('semibold', 15)

    tag = "AUTONOMOUS AI & MOBILE PLATFORMS"
    tb = f_tag.getbbox(tag)
    tw = tb[2] - tb[0]
    px = SW - int(100 * SCALE) - tw
    py = int(60 * SCALE)

    draw.rounded_rectangle([px - 16*SCALE, py - 8*SCALE, px + tw + 16*SCALE, py + 24*SCALE], radius=14*SCALE, fill=(255, 255, 255, 25), outline=(56, 189, 248, 120), width=1*SCALE)
    draw.text((px, py), tag, font=f_tag, fill=(255, 255, 255, 240))

    v_str = "Co-founder @ FrontStaff  •  Open Source"
    vb = f_sub.getbbox(v_str)
    vw = vb[2] - vb[0]
    draw.text((SW - int(100 * SCALE) - vw, py + 42 * SCALE), v_str, font=f_sub, fill=(56, 189, 248, 240))

    res = img.resize((W, H), Image.Resampling.LANCZOS)
    res.save(out_path, "PNG", optimize=True)
    print("Saved:", out_path)

# -------------------------------------------------------------
# 3. PURE MINIMALIST VIBRANT GRADIENT (Zero Text, Maximum Taste)
# The "Apple / Vercel keynote" aesthetic - pure visual wallpaper
# -------------------------------------------------------------
def make_pure_aesthetic(out_path):
    x = np.linspace(0, 1, SW)
    y = np.linspace(0, 1, SH)
    xx, yy = np.meshgrid(x, y)

    # Rich, deep obsidian-slate base
    r = 18 * (1 - yy) + 14 * yy
    g = 22 * (1 - yy) + 16 * yy
    b = 36 * (1 - yy) + 26 * yy

    # Huge sweeping radiant orb: Warm sunset gold & rose
    # Center (0.7, 0.4)
    d1 = np.sqrt(((xx - 0.70) * 1.3)**2 + ((yy - 0.38) * 2.0)**2)
    g1 = np.exp(-d1 * 2.2)
    r += g1 * 240
    g += g1 * 130
    b += g1 * 60

    # Secondary cool counterpoint: Electric violet on top edge
    d2 = np.sqrt(((xx - 0.40) * 1.5)**2 + ((yy - 0.1) * 3.0)**2)
    g2 = np.exp(-d2 * 3.0)
    r += g2 * 140
    g += g2 * 70
    b += g2 * 230

    # Bright golden highlight
    d3 = np.sqrt(((xx - 0.72) * 2.0)**2 + ((yy - 0.38) * 3.5)**2)
    g3 = np.exp(-d3 * 4.5)
    r += g3 * 255
    g += g3 * 220
    b += g3 * 160

    rgb = np.stack([
        np.clip(r, 0, 255).astype(np.uint8),
        np.clip(g, 0, 255).astype(np.uint8),
        np.clip(b, 0, 255).astype(np.uint8),
        np.full((SH, SW), 255, dtype=np.uint8)
    ], axis=-1)

    img = Image.fromarray(rgb, "RGBA")

    # Add ultra-clean architectural glassmorphism curves
    glass = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    d_glass = ImageDraw.Draw(glass)

    # Subtle concentric rings radiating from the light source
    cx, cy = int(SW * 0.70), int(SH * 0.38)
    for radius in [120*SCALE, 200*SCALE, 300*SCALE, 420*SCALE, 560*SCALE]:
        d_glass.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], outline=(255, 255, 255, 30), width=int(1.2 * SCALE))

    # Delicate tangent rays
    d_glass.line([(cx - 600*SCALE, cy), (cx + 600*SCALE, cy)], fill=(255, 255, 255, 20), width=int(1*SCALE))
    d_glass.line([(cx, cy - 300*SCALE), (cx, cy + 300*SCALE)], fill=(255, 255, 255, 20), width=int(1*SCALE))

    img = Image.alpha_composite(img, glass)

    res = img.resize((W, H), Image.Resampling.LANCZOS)
    res.save(out_path, "PNG", optimize=True)
    print("Saved:", out_path)

if __name__ == "__main__":
    os.makedirs("/workspace/framevane-broadcaster/assets/banners", exist_ok=True)
    make_luminous_horizon("/workspace/framevane-broadcaster/assets/banners/banner-horizon.png")
    make_electric_network("/workspace/framevane-broadcaster/assets/banners/banner-electric-network.png")
    make_pure_aesthetic("/workspace/framevane-broadcaster/assets/banners/banner-pure-sunset.png")
