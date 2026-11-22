#!/usr/bin/env python3
"""
Generates 3 professional 1500x500 X profile banner options for Abubakar Ibrahim (@Abubakaribro1 / ibro1).
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1500, 500
SCALE = 2
SW, SH = W * SCALE, H * SCALE

FONT_DIR = "/workspace/framevane-broadcaster/node_modules/@expo-google-fonts/inter"
OCTICONS_PATH = "/workspace/framevane-broadcaster/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Octicons.ttf"
FEATHER_PATH = "/workspace/framevane-broadcaster/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf"
SCREENSHOT_PATH = "/workspace/framevane-broadcaster/assets/screenshots/live-broadcast.png"

def get_inter(weight, size):
    path = os.path.join(FONT_DIR, weight, f"Inter_{weight}.ttf")
    return ImageFont.truetype(path, int(size * SCALE))

def get_octicon(size):
    return ImageFont.truetype(OCTICONS_PATH, int(size * SCALE))

def get_feather(size):
    return ImageFont.truetype(FEATHER_PATH, int(size * SCALE))

def draw_pill(draw, box, radius, fill, border=None, border_width=1):
    draw.rounded_rectangle(box, radius=radius, fill=fill)
    if border and border_width > 0:
        draw.rounded_rectangle(box, radius=radius, outline=border, width=border_width)

def render_banner(theme_name, config, output_path):
    bg_top = config["bg_top"]
    bg_bot = config["bg_bot"]
    accent_amber = config.get("accent_amber", (245, 158, 11))
    accent_gold = config.get("accent_gold", (251, 191, 36))
    text_white = (255, 255, 255)
    text_muted = config.get("text_muted", (156, 163, 175))
    text_dim = config.get("text_dim", (107, 114, 128))
    
    # 1. Canvas & Background Gradient
    canvas = Image.new("RGBA", (SW, SH), (0, 0, 0, 255))
    bg = Image.new("RGBA", (SW, SH))
    bg_draw = ImageDraw.Draw(bg)
    for y in range(SH):
        t = y / float(SH)
        # slight diagonal gradient
        r = int(bg_top[0] * (1 - t) + bg_bot[0] * t)
        g = int(bg_top[1] * (1 - t) + bg_bot[1] * t)
        b = int(bg_top[2] * (1 - t) + bg_bot[2] * t)
        bg_draw.line([(0, y), (SW, y)], fill=(r, g, b, 255))
    canvas = Image.alpha_composite(canvas, bg)

    # 2. Lighting / Ambient Spotlight
    lights = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lights)
    
    # Amber backlight bloom behind the phone (around x = 1200, y = 250)
    cx_phone = int(1210 * SCALE)
    cy_phone = int(250 * SCALE)
    glow_alpha = config.get("glow_alpha", 45)
    ld.ellipse(
        [cx_phone - 340 * SCALE, cy_phone - 220 * SCALE, cx_phone + 340 * SCALE, cy_phone + 220 * SCALE],
        fill=(accent_amber[0], accent_amber[1], accent_amber[2], glow_alpha)
    )
    ld.ellipse(
        [cx_phone - 200 * SCALE, cy_phone - 140 * SCALE, cx_phone + 200 * SCALE, cy_phone + 140 * SCALE],
        fill=(accent_gold[0], accent_gold[1], accent_gold[2], int(glow_alpha * 0.7))
    )
    
    # Ambient top-left soft glow
    ambient_color = config.get("ambient_color", (245, 158, 11))
    ambient_alpha = config.get("ambient_alpha", 15)
    ld.ellipse(
        [int(480 * SCALE) - 300 * SCALE, int(60 * SCALE) - 150 * SCALE, int(480 * SCALE) + 300 * SCALE, int(60 * SCALE) + 150 * SCALE],
        fill=(ambient_color[0], ambient_color[1], ambient_color[2], ambient_alpha)
    )
    
    lights = lights.filter(ImageFilter.GaussianBlur(80 * SCALE))
    canvas = Image.alpha_composite(canvas, lights)
    
    # Vignette
    vignette = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    vig_color = config.get("vignette_color", (0, 0, 0, 90))
    vd.rectangle([0, 0, SW, SH], fill=vig_color)
    vd.ellipse([int(200 * SCALE), int(40 * SCALE), SW - int(200 * SCALE), SH - int(40 * SCALE)], fill=(0, 0, 0, 0))
    vignette = vignette.filter(ImageFilter.GaussianBlur(120 * SCALE))
    canvas = Image.alpha_composite(canvas, vignette)
    
    d = ImageDraw.Draw(canvas)
    
    # Subtle camera viewfinder corner marks in top-left atmosphere (x=60, y=50)
    c_x, c_y = int(60 * SCALE), int(50 * SCALE)
    c_len = int(18 * SCALE)
    c_col = config.get("grid_reticle", (255, 255, 255, 30))
    d.line([(c_x, c_y), (c_x + c_len, c_y)], fill=c_col, width=int(1.5 * SCALE))
    d.line([(c_x, c_y), (c_x, c_y + c_len)], fill=c_col, width=int(1.5 * SCALE))
    
    # Micro viewfinder text
    font_micro = get_inter("600SemiBold", 9)
    d.text((c_x + int(24 * SCALE), c_y), "REC • STANDBY", font=font_micro, fill=config.get("reticle_text", (156, 163, 175, 90)))

    # =========================================================
    # CENTER-LEFT CONTENT: x = 420pt .. 950pt (Safe from Avatar)
    # =========================================================
    x_main = int(410 * SCALE)
    
    # 1. Top builder status pill
    y_pill = int(48 * SCALE)
    font_badge = get_inter("700Bold", 10.5)
    badge_text = "OPEN SOURCE BUILDER"
    tb = font_badge.getbbox(badge_text)
    pw = (tb[2] - tb[0]) + int(20 * SCALE)
    ph = int(22 * SCALE)
    draw_pill(d, [x_main, y_pill, x_main + pw, y_pill + ph], radius=ph // 2,
              fill=config.get("badge_bg", (245, 158, 11, 26)),
              border=config.get("badge_border", (245, 158, 11, 140)),
              border_width=int(1.2 * SCALE))
    d.text((x_main + int(10 * SCALE), y_pill + int(3.5 * SCALE)), badge_text, font=font_badge, fill=accent_gold)
    
    # Second micro pill: "SHIPPING IN PUBLIC"
    font_oct = get_octicon(10)
    oct_code = chr(61879) # octocat
    badge2_text = " github.com/ibro1"
    tb2 = font_badge.getbbox(badge2_text)
    pw2 = (tb2[2] - tb2[0]) + int(32 * SCALE)
    x_pill2 = x_main + pw + int(10 * SCALE)
    draw_pill(d, [x_pill2, y_pill, x_pill2 + pw2, y_pill + ph], radius=ph // 2,
              fill=config.get("card_bg", (255, 255, 255, 15)),
              border=config.get("card_border", (255, 255, 255, 40)),
              border_width=int(1.2 * SCALE))
    d.text((x_pill2 + int(10 * SCALE), y_pill + int(5 * SCALE)), oct_code, font=font_oct, fill=text_white)
    d.text((x_pill2 + int(24 * SCALE), y_pill + int(3.5 * SCALE)), badge2_text, font=font_badge, fill=text_white)
    
    # 2. Creator Name
    y_name = int(82 * SCALE)
    font_name = get_inter("900Black", 32)
    d.text((x_main, y_name), "ABUBAKAR IBRAHIM", font=font_name, fill=text_white)
    
    # 3. Creator Subtitle
    y_sub = int(128 * SCALE)
    font_sub = get_inter("700Bold", 14.5)
    d.text((x_main, y_sub), "Mobile Systems & Autonomous AI Infrastructure", font=font_sub, fill=accent_gold)
    
    # 4. Philosophy / Bio Line
    y_desc = int(152 * SCALE)
    font_desc = get_inter("400Regular", 12)
    d.text((x_main, y_desc), "Crafting high-performance Android & React Native media tools in public.", font=font_desc, fill=text_muted)
    
    # 5. Featured Project Card: LONG TAKE
    y_card = int(184 * SCALE)
    card_w = int(520 * SCALE)
    card_h = int(195 * SCALE)
    draw_pill(d, [x_main, y_card, x_main + card_w, y_card + card_h], radius=int(14 * SCALE),
              fill=config.get("project_card_bg", (16, 22, 38, 220)),
              border=config.get("project_card_border", (42, 55, 86, 200)),
              border_width=int(1.2 * SCALE))
    
    # Inside Card: Header row (Brand mark + LONG TAKE + v1.0.0 + GPL-3.0)
    ic_x = x_main + int(18 * SCALE)
    ic_y = y_card + int(16 * SCALE)
    
    # Mini Long Take Mark
    bm_cx = ic_x + int(10 * SCALE)
    bm_cy = ic_y + int(10 * SCALE)
    b_w = int(18 * SCALE)
    b_h = int(5 * SCALE)
    b_r = int(b_h * 0.9)
    b_left = bm_cx - b_w // 2 + b_r // 2
    d.rounded_rectangle([b_left, bm_cy - b_h // 2, b_left + b_w, bm_cy + b_h // 2], radius=b_h // 2, fill=text_white)
    d.ellipse([b_left - b_r, bm_cy - b_r, b_left + b_r, bm_cy + b_r], fill=accent_amber)
    # Reticle corners
    c_arm = int(4 * SCALE)
    c_hw, c_hh = int(11 * SCALE), int(11 * SCALE)
    for dx_c, dy_c in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        px, py = bm_cx + dx_c * c_hw, bm_cy + dy_c * c_hh
        d.line([(px, py), (px - dx_c * c_arm, py)], fill=text_dim, width=max(1, int(1.2 * SCALE)))
        d.line([(px, py), (px, py - dy_c * c_arm)], fill=text_dim, width=max(1, int(1.2 * SCALE)))

    font_lt = get_inter("800ExtraBold", 15)
    d.text((ic_x + int(28 * SCALE), ic_y + int(1 * SCALE)), "LONG TAKE", font=font_lt, fill=text_white)
    
    # v1.0.0 Pill
    lt_badge_x = ic_x + int(130 * SCALE)
    font_lt_badge = get_inter("700Bold", 9.5)
    lt_btext = "v1.0.0 RELEASE"
    tb_lt = font_lt_badge.getbbox(lt_btext)
    lt_bw = (tb_lt[2] - tb_lt[0]) + int(14 * SCALE)
    lt_bh = int(19 * SCALE)
    draw_pill(d, [lt_badge_x, ic_y + int(1 * SCALE), lt_badge_x + lt_bw, ic_y + int(1 * SCALE) + lt_bh], radius=lt_bh // 2,
              fill=(accent_amber[0], accent_amber[1], accent_amber[2], 30),
              border=(accent_amber[0], accent_amber[1], accent_amber[2], 140),
              border_width=int(1 * SCALE))
    d.text((lt_badge_x + int(7 * SCALE), ic_y + int(3.5 * SCALE)), lt_btext, font=font_lt_badge, fill=accent_gold)
    
    # GPL-3.0 Pill
    gpl_x = lt_badge_x + lt_bw + int(8 * SCALE)
    gpl_text = "GPL-3.0"
    tb_gpl = font_lt_badge.getbbox(gpl_text)
    gpl_w = (tb_gpl[2] - tb_gpl[0]) + int(14 * SCALE)
    draw_pill(d, [gpl_x, ic_y + int(1 * SCALE), gpl_x + gpl_w, ic_y + int(1 * SCALE) + lt_bh], radius=lt_bh // 2,
              fill=(255, 255, 255, 12),
              border=(255, 255, 255, 30),
              border_width=int(1 * SCALE))
    d.text((gpl_x + int(7 * SCALE), ic_y + int(3.5 * SCALE)), gpl_text, font=font_lt_badge, fill=text_muted)
    
    # Project Tagline
    font_lt_desc = get_inter("500Medium", 12.5)
    d.text((ic_x, ic_y + int(28 * SCALE)), "Open-source Filmic camera & low-latency live broadcaster for Android", font=font_lt_desc, fill=text_white)
    
    # Features List inside Card
    card_feats = [
        "Hardware H.264 (RootEncoder)",
        "Cellular-Resilient SRT & RTMP",
        "Mid-Broadcast Bitrate Tuning",
        "USB / Wireless Mic Auto-Failover"
    ]
    font_cf = get_inter("500Medium", 11)
    font_feather = get_feather(11)
    chk_char = chr(61739)
    
    cy_f1 = ic_y + int(56 * SCALE)
    cy_f2 = ic_y + int(78 * SCALE)
    
    # Row 1
    d.text((ic_x, cy_f1), chk_char, font=font_feather, fill=accent_gold)
    d.text((ic_x + int(16 * SCALE), cy_f1), card_feats[0], font=font_cf, fill=text_muted)
    
    d.text((ic_x + int(245 * SCALE), cy_f1), chk_char, font=font_feather, fill=accent_gold)
    d.text((ic_x + int(261 * SCALE), cy_f1), card_feats[1], font=font_cf, fill=text_muted)
    
    # Row 2
    d.text((ic_x, cy_f2), chk_char, font=font_feather, fill=accent_gold)
    d.text((ic_x + int(16 * SCALE), cy_f2), card_feats[2], font=font_cf, fill=text_muted)
    
    d.text((ic_x + int(245 * SCALE), cy_f2), chk_char, font=font_feather, fill=accent_gold)
    d.text((ic_x + int(261 * SCALE), cy_f2), card_feats[3], font=font_cf, fill=text_muted)
    
    # Divider line inside card
    d.line([(ic_x, ic_y + int(106 * SCALE)), (x_main + card_w - int(18 * SCALE), ic_y + int(106 * SCALE))],
           fill=config.get("card_border", (255, 255, 255, 25)), width=int(1 * SCALE))
           
    # Bottom of card: Tech stack tags
    font_tag = get_inter("600SemiBold", 10)
    tech_tags = ["React Native", "Expo 54", "Android MediaCodec", "Kotlin", "Zero Telemetry"]
    tx_cursor = ic_x
    for tag in tech_tags:
        tb_t = font_tag.getbbox(tag)
        tw = (tb_t[2] - tb_t[0]) + int(14 * SCALE)
        th = int(20 * SCALE)
        draw_pill(d, [tx_cursor, ic_y + int(116 * SCALE), tx_cursor + tw, ic_y + int(116 * SCALE) + th], radius=th // 2,
                  fill=(255, 255, 255, 10), border=(255, 255, 255, 25), border_width=int(1 * SCALE))
        d.text((tx_cursor + int(7 * SCALE), ic_y + int(119 * SCALE)), tag, font=font_tag, fill=config.get("tag_color", (209, 213, 219)))
        tx_cursor += tw + int(7 * SCALE)
        
    # 6. Bottom Row: GitHub Repository Link & CTA
    y_bot = int(395 * SCALE)
    font_repo = get_inter("700Bold", 12)
    font_repo_oct = get_octicon(14)
    d.text((x_main, y_bot + int(2 * SCALE)), oct_code, font=font_repo_oct, fill=text_white)
    d.text((x_main + int(20 * SCALE), y_bot), "github.com/ibro1/long-take", font=font_repo, fill=text_white)
    
    # Pinned handle
    font_handle = get_inter("500Medium", 12)
    d.text((x_main + int(230 * SCALE), y_bot), "•  @Abubakaribro1 on X", font=font_handle, fill=accent_gold)

    # =========================================================
    # RIGHT COLUMN: Flagship Smartphone Mockup (Landscape)
    # =========================================================
    phone_x = int(980 * SCALE)
    phone_w = int(465 * SCALE)
    bezel_side = int(19 * SCALE)
    bezel_tb = int(15 * SCALE)
    
    screen_w = phone_w - bezel_side * 2
    screen_h = int(screen_w / (900.0 / 502.0))
    phone_h = screen_h + bezel_tb * 2
    phone_y = int((SH - phone_h) / 2) # centered vertically
    
    # Shadows
    shadow_ambient = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    sda = ImageDraw.Draw(shadow_ambient)
    sda.rounded_rectangle(
        [phone_x - int(16 * SCALE), phone_y + int(16 * SCALE), phone_x + phone_w + int(16 * SCALE), phone_y + phone_h + int(36 * SCALE)],
        radius=int(36 * SCALE),
        fill=(0, 0, 0, 190)
    )
    shadow_ambient = shadow_ambient.filter(ImageFilter.GaussianBlur(32 * SCALE))
    
    shadow_contact = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    sdc = ImageDraw.Draw(shadow_contact)
    sdc.rounded_rectangle(
        [phone_x - int(4 * SCALE), phone_y + int(6 * SCALE), phone_x + phone_w + int(4 * SCALE), phone_y + phone_h + int(14 * SCALE)],
        radius=int(28 * SCALE),
        fill=(0, 0, 0, 230)
    )
    shadow_contact = shadow_contact.filter(ImageFilter.GaussianBlur(10 * SCALE))
    
    canvas = Image.alpha_composite(canvas, shadow_ambient)
    canvas = Image.alpha_composite(canvas, shadow_contact)
    d = ImageDraw.Draw(canvas)
    
    # Phone Chassis
    chassis_fill = config.get("chassis_fill", (22, 24, 30))
    chassis_border = config.get("chassis_border", (80, 85, 100))
    phone_radius = int(28 * SCALE)
    draw_pill(
        d,
        [phone_x, phone_y, phone_x + phone_w, phone_y + phone_h],
        radius=phone_radius,
        fill=chassis_fill,
        border=chassis_border,
        border_width=int(2.2 * SCALE)
    )
    
    # Inner bezel line
    draw_pill(
        d,
        [phone_x + int(2.2 * SCALE), phone_y + int(2.2 * SCALE), phone_x + phone_w - int(2.2 * SCALE), phone_y + phone_h - int(2.2 * SCALE)],
        radius=phone_radius - int(2.2 * SCALE),
        fill=None,
        border=(34, 37, 46),
        border_width=int(1.2 * SCALE)
    )
    
    # Screen image
    screen_x = phone_x + bezel_side
    screen_y = phone_y + bezel_tb
    screen_radius = int(14 * SCALE)
    
    if os.path.exists(SCREENSHOT_PATH):
        raw_ss = Image.open(SCREENSHOT_PATH).convert("RGBA")
        raw_ss = raw_ss.resize((screen_w, screen_h), Image.Resampling.LANCZOS)
        
        mask = Image.new("L", (screen_w, screen_h), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, screen_w, screen_h], radius=screen_radius, fill=255)
        
        canvas.paste(raw_ss, (screen_x, screen_y), mask)
        d = ImageDraw.Draw(canvas)
        
    # Camera hole on bezel
    cam_x = phone_x + bezel_side // 2
    cam_y = phone_y + phone_h // 2
    cam_r = int(4 * SCALE)
    d.ellipse([cam_x - cam_r, cam_y - cam_r, cam_x + cam_r, cam_y + cam_r], fill=(12, 14, 18))
    d.ellipse([cam_x - cam_r + int(1 * SCALE), cam_y - cam_r + int(1 * SCALE), cam_x + int(1 * SCALE), cam_y + int(1 * SCALE)], fill=(45, 55, 75, 180))

    # Floating Telemetry Badge: "🔴 LIVE • SRT 1080p60 • 4.2 Mbps"
    badge_live_x = phone_x + int(20 * SCALE)
    badge_live_y = phone_y - int(16 * SCALE) # floats slightly above top of phone
    font_live = get_inter("700Bold", 10.5)
    live_text = "● LIVE"
    live_meta = "  SRT 1080p60 • 4.2 Mbps"
    tb_l = font_live.getbbox(live_text + live_meta)
    lw = (tb_l[2] - tb_l[0]) + int(24 * SCALE)
    lh = int(24 * SCALE)
    draw_pill(d, [badge_live_x, badge_live_y, badge_live_x + lw, badge_live_y + lh], radius=lh // 2,
              fill=(15, 20, 32, 230), border=(accent_amber[0], accent_amber[1], accent_amber[2], 180), border_width=int(1.2 * SCALE))
    d.text((badge_live_x + int(10 * SCALE), badge_live_y + int(4 * SCALE)), "●", font=font_live, fill=(239, 68, 68))
    d.text((badge_live_x + int(24 * SCALE), badge_live_y + int(4 * SCALE)), "LIVE", font=font_live, fill=text_white)
    d.text((badge_live_x + int(56 * SCALE), badge_live_y + int(4 * SCALE)), "• SRT 1080p60 • 4.2 Mbps", font=font_live, fill=accent_gold)
    
    # 7. Final Downsample to exact 1500x500 with Lanczos
    final_banner = canvas.resize((W, H), Image.Resampling.LANCZOS)
    final_banner.save(output_path, "PNG", optimize=True)
    print(f"Generated {output_path} ({W}x{H})")

themes = {
    "v1_midnight": {
        "bg_top": (8, 12, 24),
        "bg_bot": (14, 22, 40),
        "accent_amber": (245, 158, 11),
        "accent_gold": (252, 211, 77),
        "text_muted": (160, 175, 200),
        "text_dim": (100, 116, 139),
        "ambient_color": (245, 158, 11),
        "ambient_alpha": 18,
        "glow_alpha": 46,
        "badge_bg": (245, 158, 11, 28),
        "badge_border": (245, 158, 11, 140),
        "card_bg": (255, 255, 255, 14),
        "card_border": (255, 255, 255, 36),
        "project_card_bg": (14, 20, 36, 230),
        "project_card_border": (38, 52, 85, 210),
        "chassis_fill": (20, 24, 32),
        "chassis_border": (75, 85, 105),
        "tag_color": (210, 225, 245),
        "output": "/workspace/framevane-broadcaster/assets/x-banner-v1-midnight.png"
    },
    "v2_obsidian": {
        "bg_top": (10, 11, 15),
        "bg_bot": (18, 20, 26),
        "accent_amber": (245, 158, 11),
        "accent_gold": (251, 191, 36),
        "text_muted": (156, 163, 175),
        "text_dim": (107, 114, 128),
        "ambient_color": (245, 158, 11),
        "ambient_alpha": 16,
        "glow_alpha": 42,
        "badge_bg": (245, 158, 11, 26),
        "badge_border": (245, 158, 11, 140),
        "card_bg": (255, 255, 255, 12),
        "card_border": (255, 255, 255, 32),
        "project_card_bg": (20, 22, 28, 235),
        "project_card_border": (50, 54, 66, 200),
        "chassis_fill": (24, 25, 30),
        "chassis_border": (90, 93, 105),
        "tag_color": (209, 213, 219),
        "output": "/workspace/framevane-broadcaster/assets/x-banner-v2-obsidian.png"
    },
    "v3_espresso": {
        "bg_top": (15, 14, 13),
        "bg_bot": (25, 23, 20),
        "accent_amber": (245, 158, 11),
        "accent_gold": (251, 191, 36),
        "text_muted": (168, 162, 158),
        "text_dim": (120, 113, 108),
        "ambient_color": (245, 158, 11),
        "ambient_alpha": 14,
        "glow_alpha": 40,
        "badge_bg": (245, 158, 11, 26),
        "badge_border": (245, 158, 11, 140),
        "card_bg": (255, 255, 255, 12),
        "card_border": (255, 255, 255, 30),
        "project_card_bg": (26, 23, 20, 235),
        "project_card_border": (64, 58, 52, 200),
        "chassis_fill": (28, 26, 24),
        "chassis_border": (95, 90, 85),
        "tag_color": (214, 211, 209),
        "output": "/workspace/framevane-broadcaster/assets/x-banner-v3-espresso.png"
    }
}

for name, cfg in themes.items():
    render_banner(name, cfg, cfg["output"])
