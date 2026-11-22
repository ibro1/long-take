from PIL import ImageFont

FONT_DIR = "/workspace/framevane-broadcaster/node_modules/@expo-google-fonts/inter"
font_lt_desc = ImageFont.truetype(f"{FONT_DIR}/500Medium/Inter_500Medium.ttf", int(12.5 * 2))
text = "Open-source Filmic camera & low-latency live broadcaster for Android"
bbox = font_lt_desc.getbbox(text)
w_pt = (bbox[2] - bbox[0]) / 2.0
print("Tagline width in pt:", w_pt, "Card available width: 484 pt")

font_cf = ImageFont.truetype(f"{FONT_DIR}/500Medium/Inter_500Medium.ttf", int(11 * 2))
col1_text = "Hardware H.264 (RootEncoder)"
col2_text = "Cellular-Resilient SRT & RTMP"
w1 = (font_cf.getbbox(col1_text)[2] - font_cf.getbbox(col1_text)[0]) / 2.0
w2 = (font_cf.getbbox(col2_text)[2] - font_cf.getbbox(col2_text)[0]) / 2.0
print("Col 1 width:", w1, "Col 2 width:", w2, "Sum + gap:", w1 + 16 + w2 + 16, "vs 484")

tech_tags = ["React Native", "Expo 54", "Android MediaCodec", "Kotlin", "Zero Telemetry"]
font_tag = ImageFont.truetype(f"{FONT_DIR}/600SemiBold/Inter_600SemiBold.ttf", int(10 * 2))
total_tags_w = 0
for t in tech_tags:
    tb = font_tag.getbbox(t)
    tw = (tb[2] - tb[0]) / 2.0 + 14
    total_tags_w += tw + 7
print("Total tags width:", total_tags_w, "vs 484")
