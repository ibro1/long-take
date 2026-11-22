import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1500, 500
SCALE = 2
SW, SH = W * SCALE, H * SCALE

FONTS = {
    'black': '/usr/share/fonts/truetype/inter/Inter-Black.ttf',
    'extrabold': '/usr/share/fonts/truetype/inter/Inter-ExtraBold.ttf',
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

def draw_founder_banner(style_name, bg_theme, out_path):
    img = Image.new("RGBA", (SW, SH), (0, 0, 0, 255))
    draw = ImageDraw.Draw(img)

    # 1. Base Gradient
    top_c, bot_c, glow_c, accent_c = bg_theme
    for y in range(SH):
        t = y / SH
        r = int(top_c[0] + (bot_c[0] - top_c[0]) * t)
        g = int(top_c[1] + (bot_c[1] - top_c[1]) * t)
        b = int(top_c[2] + (bot_c[2] - top_c[2]) * t)
        draw.line([(0, y), (SW, y)], fill=(r, g, b, 255))

    # 2. Subtle architectural / studio glow
    glow_layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_layer)
    
    # Ambient warm glow top-right
    for rad in range(700, 0, -25):
        alpha = int(35 * (1 - rad / 700))
        glow_draw.ellipse([SW - 600 - rad, -200 - rad, SW - 600 + rad, -200 + rad], fill=(*glow_c, alpha))
    
    # Subtle ambient glow behind avatar safe-area bottom-left
    for rad in range(500, 0, -30):
        alpha = int(18 * (1 - rad / 500))
        glow_draw.ellipse([250 - rad, SH - 100 - rad, 250 + rad, SH - 100 + rad], fill=(*glow_c, alpha))

    img = Image.alpha_composite(img, glow_layer)
    draw = ImageDraw.Draw(img)

    # 3. Minimalist Architectural Grid / Crosshairs (Ultra subtle)
    grid_layer = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    grid_draw = ImageDraw.Draw(grid_layer)
    
    # Elegant thin coordinate lines
    line_alpha = 18
    # Horizontal guideline
    grid_draw.line([(100 * SCALE, int(SH * 0.45)), (SW - 100 * SCALE, int(SH * 0.45))], fill=(255, 255, 255, line_alpha), width=1 * SCALE)
    # Right-aligned vertical axis
    grid_draw.line([(int(SW * 0.72), 60 * SCALE), (int(SW * 0.72), SH - 60 * SCALE)], fill=(255, 255, 255, line_alpha), width=1 * SCALE)
    
    # Subtle corner crosshairs
    def draw_cross(x, y, s=8*SCALE):
        grid_draw.line([(x - s, y), (x + s, y)], fill=(255, 255, 255, 30), width=1*SCALE)
        grid_draw.line([(x, y - s), (x, y + s)], fill=(255, 255, 255, 30), width=1*SCALE)
        
    draw_cross(SW - 120 * SCALE, 80 * SCALE)
    draw_cross(SW - 120 * SCALE, SH - 80 * SCALE)
    draw_cross(int(SW * 0.72), int(SH * 0.45))
    
    # Dot matrix cluster top-right (tasteful engineering motif)
    for row in range(5):
        for col in range(9):
            dx = SW - (320 - col * 24) * SCALE
            dy = (80 + row * 24) * SCALE
            grid_draw.ellipse([dx, dy, dx + 2 * SCALE, dy + 2 * SCALE], fill=(255, 255, 255, 22))

    img = Image.alpha_composite(img, grid_layer)
    draw = ImageDraw.Draw(img)

    # 4. Content Layout - Perfectly balanced for X Avatar overlap (avatar is bottom-left)
    # Safe area: content starts from x = 440px on 1500px canvas (or centered/top-weighted)
    
    # Small top pre-header tag
    tag_x = int(430 * SCALE)
    tag_y = int(90 * SCALE)
    
    # Subtle pill badge: "FOUNDER & SYSTEMS BUILDER"
    badge_text = "FOUNDER • SYSTEMS ENGINEER • OPEN SOURCE"
    f_badge = font('bold', 10.5)
    bbox = f_badge.getbbox(badge_text)
    bw, bh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    
    # Pill background
    pad_h, pad_v = 14 * SCALE, 7 * SCALE
    draw.rounded_rectangle([tag_x, tag_y, tag_x + bw + pad_h * 2, tag_y + bh + pad_v * 2], radius=12*SCALE, fill=(255, 255, 255, 12), outline=(*accent_c, 60), width=1*SCALE)
    draw.text((tag_x + pad_h, tag_y + pad_v - bbox[1]), badge_text, font=f_badge, fill=accent_c)

    # Main Name Headline: "ABUBAKAR IBRAHIM"
    name_y = tag_y + bh + pad_v * 2 + 18 * SCALE
    f_name = font('black', 44)
    draw.text((tag_x, name_y), "ABUBAKAR IBRAHIM", font=f_name, fill=(255, 255, 255, 255))
    
    # Sub-headline / Venture Line:
    # "Co-founder @ FrontStaff  •  Creator of Long Take"
    sub_y = name_y + 60 * SCALE
    f_sub = font('semibold', 18)
    
    # Draw compound line with distinct styling
    v_prefix = "Co-founder at "
    v_brand1 = "FrontStaff"
    v_mid = "  /  Creator of "
    v_brand2 = "Long Take"
    v_dot = "  •  "
    v_domain = "Autonomous AI & Mobile Systems"

    # Measuring parts
    draw.text((tag_x, sub_y), v_prefix, font=f_sub, fill=(180, 185, 200, 255))
    w_prefix = f_sub.getbbox(v_prefix)[2]
    
    draw.text((tag_x + w_prefix, sub_y), v_brand1, font=font('bold', 18), fill=(255, 255, 255, 255))
    w_brand1 = font('bold', 18).getbbox(v_brand1)[2]
    
    cur_x = tag_x + w_prefix + w_brand1
    draw.text((cur_x, sub_y), v_mid, font=f_sub, fill=(140, 145, 160, 255))
    cur_x += f_sub.getbbox(v_mid)[2]
    
    draw.text((cur_x, sub_y), v_brand2, font=font('bold', 18), fill=accent_c)
    cur_x += font('bold', 18).getbbox(v_brand2)[2]
    
    draw.text((cur_x, sub_y), v_dot, font=f_sub, fill=(120, 125, 140, 255))
    cur_x += f_sub.getbbox(v_dot)[2]
    
    draw.text((cur_x, sub_y), v_domain, font=font('medium', 18), fill=(160, 165, 180, 255))

    # Philosophy / Tech Stacks (Clean horizontal metric bar)
    bar_y = sub_y + 46 * SCALE
    f_tech = font('medium', 12)
    tech_items = [
        "React Native & Expo",
        "Native Android & Kotlin",
        "Autonomous Agent Architecture",
        "Open Live Broadcasting"
    ]
    
    t_x = tag_x
    for i, item in enumerate(tech_items):
        item_text = f"// {item}"
        draw.text((t_x, bar_y), item_text, font=f_tech, fill=(130, 136, 150, 220))
        t_x += f_tech.getbbox(item_text)[2] + 28 * SCALE

    # 5. Right-side clean signature graphic: Minimalist Monogram / Signal Mark
    # Instead of an aggressive phone mockup, a high-craft architectural emblem
    mark_cx = int(SW - 180 * SCALE)
    mark_cy = int(SH * 0.5)
    
    # Outer ring
    draw.circle((mark_cx, mark_cy), 85 * SCALE, outline=(255, 255, 255, 20), width=1 * SCALE)
    draw.circle((mark_cx, mark_cy), 65 * SCALE, outline=(*accent_c, 50), width=1 * SCALE)
    draw.circle((mark_cx, mark_cy), 4 * SCALE, fill=(*accent_c, 255))
    
    # Subtle orbital tick marks
    for deg in range(0, 360, 30):
        rad = math.radians(deg)
        x1 = mark_cx + math.cos(rad) * 78 * SCALE
        y1 = mark_cy + math.sin(rad) * 78 * SCALE
        x2 = mark_cx + math.cos(rad) * 85 * SCALE
        y2 = mark_cy + math.sin(rad) * 85 * SCALE
        draw.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, 35), width=1 * SCALE)

    # Coordinates tag under mark
    f_coord = font('regular', 9)
    coord_txt = "9.0820° N, 8.6753° E"
    cw = f_coord.getbbox(coord_txt)[2]
    draw.text((mark_cx - cw // 2, mark_cy + 100 * SCALE), coord_txt, font=f_coord, fill=(120, 125, 140, 180))

    # Resample with Lanczos for 2x retina crispness
    final_img = img.resize((W, H), Image.Resampling.LANCZOS)
    final_img.save(out_path, "PNG", optimize=True)
    print(f"Saved: {out_path}")

# Generate Variations
# Theme 1: Deep Studio Obsidian & Warm Amber (matches your personal aesthetic)
draw_founder_banner(
    "obsidian",
    ((11, 13, 18), (6, 7, 10), (245, 158, 11), (245, 158, 11)),
    "/workspace/framevane-broadcaster/assets/x-founder-banner-obsidian.png"
)

# Theme 2: Minimalist Midnight Indigo & Electric Blue (Venture / AI tech aesthetic)
draw_founder_banner(
    "midnight",
    ((12, 17, 30), (7, 10, 18), (56, 189, 248), (56, 189, 248)),
    "/workspace/framevane-broadcaster/assets/x-founder-banner-midnight.png"
)

# Theme 3: Stealth Carbon & Pure White / Gold
draw_founder_banner(
    "stealth",
    ((16, 16, 18), (9, 9, 10), (234, 179, 8), (250, 204, 21)),
    "/workspace/framevane-broadcaster/assets/x-founder-banner-stealth.png"
)
