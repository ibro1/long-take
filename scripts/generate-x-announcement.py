#!/usr/bin/env python3
"""
Generates the 16:9 X (Twitter) announcement card for Long Take v1.0.0.
Designed to seasoned art-direction & product-marketing standards:
- Studio dark backdrop with ambient lighting & rim glows (zero distracting grid mesh)
- Inter typography (Black, Bold, SemiBold, Regular)
- Authentic vector icons from Octicons & Feather
- Titanium flagship landscape smartphone mockup with undistorted 1.79:1 native aspect ratio
- Multi-layered studio drop shadows and subtle glass glare
- Clean two-column layout with generous gutters and AAA contrast
- Cohesive color-matching with Long Take's signature amber tally mark and warm camera viewfinder
"""
import os
import math
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1200, 675
SCALE = 2  # 2x supersampling for ultra-crisp antialiasing
SW, SH = W * SCALE, H * SCALE

FONT_DIR = "/workspace/framevane-broadcaster/node_modules/@expo-google-fonts/inter"
OCTICONS_PATH = "/workspace/framevane-broadcaster/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Octicons.ttf"
FEATHER_PATH = "/workspace/framevane-broadcaster/node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/Fonts/Feather.ttf"

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

def render_announcement(theme_name, config, output_path):
    bg_top = config["bg_top"]
    bg_bot = config["bg_bot"]
    accent_amber = config.get("accent_amber", (245, 158, 11))
    accent_gold = config.get("accent_gold", (251, 191, 36))
    headline_color2 = config.get("headline_color2", (245, 158, 11))
    text_white = (255, 255, 255)
    text_muted = config.get("text_muted", (156, 163, 175))
    text_dim = config.get("text_dim", (107, 114, 128))
    
    # 1. Base Canvas & Smooth Gradient
    canvas = Image.new("RGBA", (SW, SH), (0, 0, 0, 255))
    d = ImageDraw.Draw(canvas)
    
    for y in range(SH):
        factor = y / SH
        r = int(bg_top[0] * (1 - factor) + bg_bot[0] * factor)
        g = int(bg_top[1] * (1 - factor) + bg_bot[1] * factor)
        b = int(bg_top[2] * (1 - factor) + bg_bot[2] * factor)
        d.line([(0, y), (SW, y)], fill=(r, g, b, 255))
        
    # 2. Studio Lighting Layer
    lights = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lights)
    
    cx_phone = int(894 * SCALE)
    cy_phone = int(337 * SCALE)
    
    glow_color = config.get("phone_glow", (245, 158, 11))
    glow_alpha1 = config.get("glow_alpha1", 38)
    glow_alpha2 = config.get("glow_alpha2", 24)
    
    ld.ellipse(
        [cx_phone - 460 * SCALE, cy_phone - 310 * SCALE, cx_phone + 460 * SCALE, cy_phone + 310 * SCALE],
        fill=(glow_color[0], glow_color[1], glow_color[2], glow_alpha1)
    )
    ld.ellipse(
        [cx_phone - 240 * SCALE, cy_phone - 160 * SCALE, cx_phone + 240 * SCALE, cy_phone + 160 * SCALE],
        fill=(accent_gold[0], accent_gold[1], accent_gold[2], glow_alpha2)
    )
    
    ambient_color = config.get("ambient_color", (245, 158, 11))
    ambient_alpha = config.get("ambient_alpha", 12)
    ld.ellipse(
        [int(220 * SCALE) - 260 * SCALE, int(90 * SCALE) - 180 * SCALE, int(220 * SCALE) + 260 * SCALE, int(90 * SCALE) + 180 * SCALE],
        fill=(ambient_color[0], ambient_color[1], ambient_color[2], ambient_alpha)
    )
    
    vignette = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    vig_color = config.get("vignette_color", (0, 0, 0, 80))
    vd.rectangle([0, 0, SW, SH], fill=vig_color)
    vd.ellipse([int(150 * SCALE), int(80 * SCALE), SW - int(150 * SCALE), SH - int(80 * SCALE)], fill=(0, 0, 0, 0))
    vignette = vignette.filter(ImageFilter.GaussianBlur(140 * SCALE))
    
    lights = lights.filter(ImageFilter.GaussianBlur(95 * SCALE))
    canvas = Image.alpha_composite(canvas, lights)
    canvas = Image.alpha_composite(canvas, vignette)
    d = ImageDraw.Draw(canvas)
    
    # =========================================================
    # LEFT COLUMN: x = 64pt .. 580pt
    # =========================================================
    x_left = int(64 * SCALE)
    
    # --- 1. Brand Mark & Header ---
    y_brand = int(52 * SCALE)
    cx = x_left + int(14 * SCALE)
    cy = y_brand + int(14 * SCALE)
    
    bar_w = int(24 * SCALE)
    bar_h = int(6 * SCALE)
    r_dot = int(bar_h * 0.9)
    bar_left = cx - bar_w // 2 + r_dot // 2
    
    d.rounded_rectangle(
        [bar_left, cy - bar_h // 2, bar_left + bar_w, cy + bar_h // 2],
        radius=bar_h // 2,
        fill=text_white
    )
    d.ellipse(
        [bar_left - r_dot, cy - r_dot, bar_left + r_dot, cy + r_dot],
        fill=accent_amber
    )
    
    c_arm = int(6 * SCALE)
    c_hw, c_hh = int(14 * SCALE), int(14 * SCALE)
    c_stroke = max(2, int(1.4 * SCALE))
    for dx_c, dy_c in [(-1, -1), (1, -1), (-1, 1), (1, 1)]:
        px, py = cx + dx_c * c_hw, cy + dy_c * c_hh
        d.line([(px, py), (px - dx_c * c_arm, py)], fill=text_dim, width=c_stroke)
        d.line([(px, py), (px, py - dy_c * c_arm)], fill=text_dim, width=c_stroke)
        
    font_brand = get_inter("800ExtraBold", 19)
    d.text((x_left + int(38 * SCALE), y_brand + int(3 * SCALE)), "LONG TAKE", font=font_brand, fill=text_white)
    
    # Version Pill Badge
    badge_x = x_left + int(178 * SCALE)
    badge_y = y_brand + int(3 * SCALE)
    font_badge = get_inter("700Bold", 11)
    badge_text = "v1.0.0 RELEASE"
    tb = font_badge.getbbox(badge_text)
    bw = (tb[2] - tb[0]) + int(16 * SCALE)
    bh = int(22 * SCALE)
    draw_pill(d, [badge_x, badge_y, badge_x + bw, badge_y + bh], radius=bh // 2,
              fill=(accent_amber[0], accent_amber[1], accent_amber[2], 32),
              border=(accent_amber[0], accent_amber[1], accent_amber[2], 140),
              border_width=int(1.2 * SCALE))
    d.text((badge_x + int(8 * SCALE), badge_y + int(3 * SCALE)), badge_text, font=font_badge, fill=accent_gold)
    
    # --- 2. Main Hero Headline ---
    y_title = int(96 * SCALE)
    font_title = get_inter("900Black", 33)
    d.text((x_left, y_title), "Filmic-Style Camera", font=font_title, fill=text_white)
    d.text((x_left, y_title + int(42 * SCALE)), "& Live Broadcaster", font=font_title, fill=headline_color2)
    
    # --- 3. Subtitle ---
    y_sub = int(186 * SCALE)
    font_sub = get_inter("400Regular", 14)
    d.text((x_left, y_sub), "Open-source manual camera & low-latency streaming for Android", font=font_sub, fill=text_muted)
    
    # --- 4. Feature Badges Row ---
    y_badges = int(218 * SCALE)
    badges = config.get("badges")
    font_pills = get_inter("700Bold", 11)
    bx_cursor = x_left
    for text, t_color, bg_pill, b_pill in badges:
        box = font_pills.getbbox(text)
        pw = (box[2] - box[0]) + int(18 * SCALE)
        ph = int(26 * SCALE)
        draw_pill(d, [bx_cursor, y_badges, bx_cursor + pw, y_badges + ph], radius=ph // 2,
                  fill=bg_pill, border=b_pill, border_width=int(1.2 * SCALE))
        d.text((bx_cursor + int(9 * SCALE), y_badges + int(5 * SCALE)), text, font=font_pills, fill=t_color)
        bx_cursor += pw + int(10 * SCALE)
        
    # --- 5. Feature Highlights ---
    features = [
        ("Pro Manual Controls", "Shutter, ISO, EV, focus peaking, real-time LUTs & zebras"),
        ("Hardware H.264 Encoding", "RootEncoder direct MediaCodec pipeline with live bitrate scaling"),
        ("Cellular-Resilient SRT", "Low latency instant recovery from mobile 4G/5G packet jitter"),
        ("Auto Mic Route Failover", "USB Wireless > Wired 3.5mm > Bluetooth failover"),
        ("Split-Take Recording", "Never lose hours-long takes to unexpected crashes"),
    ]
    
    font_f_title = get_inter("700Bold", 13.5)
    font_f_desc = get_inter("400Regular", 11.5)
    font_feather = get_feather(13)
    
    y_feat = int(264 * SCALE)
    spacing_feat = int(47 * SCALE)
    chk_color = config.get("check_color", accent_gold)
    chk_border = config.get("check_border", (accent_amber[0], accent_amber[1], accent_amber[2], 100))
    chk_bg = config.get("check_bg", (24, 25, 32, 230))
    
    for title, desc in features:
        box_s = int(22 * SCALE)
        bx = x_left
        by = y_feat + int(4 * SCALE)
        draw_pill(d, [bx, by, bx + box_s, by + box_s], radius=int(6 * SCALE),
                  fill=chk_bg, border=chk_border, border_width=int(1.2 * SCALE))
        
        check_char = chr(61739)
        cb = font_feather.getbbox(check_char)
        cw = cb[2] - cb[0]
        ch = cb[3] - cb[1]
        d.text((bx + (box_s - cw) // 2 - cb[0], by + (box_s - ch) // 2 - cb[1]), check_char, font=font_feather, fill=chk_color)
        
        tx = x_left + int(32 * SCALE)
        d.text((tx, y_feat), title, font=font_f_title, fill=text_white)
        d.text((tx, y_feat + int(18 * SCALE)), desc, font=font_f_desc, fill=text_muted)
        
        y_feat += spacing_feat
        
    # --- 6. Bottom Call to Action Card ---
    y_card = int(516 * SCALE)
    card_w = int(516 * SCALE)
    card_h = int(56 * SCALE)
    
    card_bg = config.get("card_bg", (20, 22, 28, 235))
    card_border = config.get("card_border", (50, 54, 66, 200))
    draw_pill(d, [x_left, y_card, x_left + card_w, y_card + card_h], radius=int(14 * SCALE),
              fill=card_bg, border=card_border, border_width=int(1.2 * SCALE))
              
    font_octocat = get_octicon(22)
    octo_char = chr(61879)
    d.text((x_left + int(18 * SCALE), y_card + int(15 * SCALE)), octo_char, font=font_octocat, fill=text_white)
    
    font_git_text = get_inter("600SemiBold", 14)
    d.text((x_left + int(48 * SCALE), y_card + int(17 * SCALE)), "github.com/ibro1/long-take", font=font_git_text, fill=text_white)
    
    font_btn = get_inter("700Bold", 11.5)
    font_star = get_octicon(12)
    btn_text = "Star on GitHub"
    tb_btn = font_btn.getbbox(btn_text)
    btn_w = (tb_btn[2] - tb_btn[0]) + int(38 * SCALE)
    btn_h = int(28 * SCALE)
    btn_x = x_left + card_w - btn_w - int(14 * SCALE)
    btn_y = y_card + (card_h - btn_h) // 2
    
    draw_pill(d, [btn_x, btn_y, btn_x + btn_w, btn_y + btn_h], radius=btn_h // 2,
              fill=(accent_amber[0], accent_amber[1], accent_amber[2], 38),
              border=(accent_amber[0], accent_amber[1], accent_amber[2], 160),
              border_width=int(1.2 * SCALE))
              
    star_char = chr(61971)
    d.text((btn_x + int(10 * SCALE), btn_y + int(6 * SCALE)), star_char, font=font_star, fill=accent_gold)
    d.text((btn_x + int(26 * SCALE), btn_y + int(5 * SCALE)), btn_text, font=font_btn, fill=accent_gold)
    
    # =========================================================
    # RIGHT COLUMN: Landscape Smartphone Mockup
    # =========================================================
    phone_x = int(644 * SCALE)
    phone_w = int(500 * SCALE)
    bezel_side = int(22 * SCALE)
    bezel_tb = int(17 * SCALE)
    
    screen_w = phone_w - bezel_side * 2
    screen_h = int(screen_w / (900.0 / 502.0))
    phone_h = screen_h + bezel_tb * 2
    phone_y = int((SH - phone_h) / 2)
    
    shadow_ambient = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    sda = ImageDraw.Draw(shadow_ambient)
    sda.rounded_rectangle(
        [phone_x - int(14 * SCALE), phone_y + int(18 * SCALE), phone_x + phone_w + int(14 * SCALE), phone_y + phone_h + int(34 * SCALE)],
        radius=int(38 * SCALE),
        fill=(0, 0, 0, 180)
    )
    shadow_ambient = shadow_ambient.filter(ImageFilter.GaussianBlur(34 * SCALE))
    
    shadow_contact = Image.new("RGBA", (SW, SH), (0, 0, 0, 0))
    sdc = ImageDraw.Draw(shadow_contact)
    sdc.rounded_rectangle(
        [phone_x - int(4 * SCALE), phone_y + int(8 * SCALE), phone_x + phone_w + int(4 * SCALE), phone_y + phone_h + int(14 * SCALE)],
        radius=int(32 * SCALE),
        fill=(0, 0, 0, 220)
    )
    shadow_contact = shadow_contact.filter(ImageFilter.GaussianBlur(12 * SCALE))
    
    canvas = Image.alpha_composite(canvas, shadow_ambient)
    canvas = Image.alpha_composite(canvas, shadow_contact)
    d = ImageDraw.Draw(canvas)
    
    chassis_fill = config.get("chassis_fill", (24, 25, 30))
    chassis_border = config.get("chassis_border", (90, 93, 105))
    phone_radius = int(30 * SCALE)
    draw_pill(
        d,
        [phone_x, phone_y, phone_x + phone_w, phone_y + phone_h],
        radius=phone_radius,
        fill=chassis_fill,
        border=chassis_border,
        border_width=int(2.5 * SCALE)
    )
    
    draw_pill(
        d,
        [phone_x + int(2.5 * SCALE), phone_y + int(2.5 * SCALE), phone_x + phone_w - int(2.5 * SCALE), phone_y + phone_h - int(2.5 * SCALE)],
        radius=phone_radius - int(2.5 * SCALE),
        fill=None,
        border=(38, 40, 48),
        border_width=int(1.5 * SCALE)
    )
    
    screen_x = phone_x + bezel_side
    screen_y = phone_y + bezel_tb
    screen_radius = int(16 * SCALE)
    
    cam_x = phone_x + bezel_side // 2
    cam_y = phone_y + phone_h // 2
    cam_r = int(4.5 * SCALE)
    d.ellipse([cam_x - cam_r, cam_y - cam_r, cam_x + cam_r, cam_y + cam_r],
              fill=(10, 12, 18), outline=(51, 65, 85), width=int(1.2 * SCALE))
    d.ellipse([cam_x - int(cam_r * 0.4), cam_y - int(cam_r * 0.4), cam_x + int(cam_r * 0.4), cam_y + int(cam_r * 0.4)],
              fill=(20, 35, 55))
              
    spk_x = phone_x + phone_w - bezel_side // 2
    spk_h = int(22 * SCALE)
    spk_w = int(3.5 * SCALE)
    d.rounded_rectangle([spk_x - spk_w // 2, cam_y - spk_h // 2, spk_x + spk_w // 2, cam_y + spk_h // 2],
                        radius=spk_w // 2, fill=(15, 20, 28))
                        
    screen_path = "/workspace/framevane-broadcaster/assets/screenshots/live-broadcast.png"
    raw_screen = Image.open(screen_path).convert("RGBA")
    screen_resized = raw_screen.resize((screen_w, screen_h), Image.LANCZOS)
    
    mask = Image.new("L", (screen_w, screen_h), 0)
    md = ImageDraw.Draw(mask)
    md.rounded_rectangle([0, 0, screen_w, screen_h], radius=screen_radius, fill=255)
    
    glare = Image.new("RGBA", (screen_w, screen_h), (0, 0, 0, 0))
    gld = ImageDraw.Draw(glare)
    gld.polygon([(0, 0), (int(screen_w * 0.38), 0), (0, int(screen_h * 0.60))], fill=(255, 255, 255, 12))
    screen_composite = Image.alpha_composite(screen_resized, glare)
    
    canvas.paste(screen_composite, (screen_x, screen_y), mask)
    
    d = ImageDraw.Draw(canvas)
    d.rounded_rectangle([screen_x, screen_y, screen_x + screen_w, screen_y + screen_h],
                        radius=screen_radius, outline=(15, 20, 28), width=int(1.5 * SCALE))
                        
    final_card = canvas.resize((W, H), Image.LANCZOS)
    final_card.save(output_path, "PNG", optimize=True)
    print(f"Generated {theme_name} -> {output_path}")

if __name__ == "__main__":
    config_obsidian = {
        "bg_top": (11, 12, 16),
        "bg_bot": (18, 20, 26),
        "accent_amber": (245, 158, 11),
        "accent_gold": (251, 191, 36),
        "headline_color2": (245, 158, 11),
        "text_muted": (156, 163, 175),
        "text_dim": (107, 114, 128),
        "phone_glow": (245, 158, 11),
        "glow_alpha1": 36,
        "glow_alpha2": 26,
        "ambient_color": (251, 191, 36),
        "ambient_alpha": 10,
        "vignette_color": (0, 0, 0, 80),
        "check_color": (251, 191, 36),
        "check_border": (245, 158, 11, 100),
        "check_bg": (26, 28, 36, 230),
        "card_bg": (22, 24, 32, 235),
        "card_border": (52, 56, 70, 200),
        "chassis_fill": (25, 26, 32),
        "chassis_border": (92, 95, 108),
        "badges": [
            ("✦ GPL-3.0 License", (52, 211, 153), (52, 211, 153, 24), (52, 211, 153, 110)),
            ("✦ Hardware H.264", (251, 191, 36), (245, 158, 11, 26), (245, 158, 11, 120)),
            ("✦ Low-Latency SRT", (251, 191, 36), (245, 158, 11, 26), (245, 158, 11, 120)),
        ]
    }
    render_announcement("Obsidian Amber", config_obsidian, "/workspace/framevane-broadcaster/assets/x-announcement.png")
