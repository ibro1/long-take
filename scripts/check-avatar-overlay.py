from PIL import Image, ImageDraw

banner = Image.open("/workspace/framevane-broadcaster/assets/x-banner-v1-midnight.png").convert("RGBA")
overlay = banner.copy()
d = ImageDraw.Draw(overlay)

# Desktop avatar circle simulation:
# Desktop avatar: ~133px diameter at x ≈ 40..175, y ≈ 360..500+
desktop_circle = [40, 360, 40 + 135, 360 + 135]
d.ellipse(desktop_circle, fill=(255, 255, 255, 80), outline=(255, 255, 255, 220), width=3)
d.text((65, 415), "Desktop Avatar", fill=(255, 255, 255, 240))

# Mobile avatar circle simulation:
# Mobile avatar: ~180px diameter at x ≈ 30..210, y ≈ 300..480
mobile_circle = [30, 290, 30 + 190, 290 + 190]
d.ellipse(mobile_circle, fill=(245, 158, 11, 60), outline=(245, 158, 11, 200), width=2)
d.text((60, 340), "Mobile Avatar Safe Zone", fill=(251, 191, 36, 240))

overlay.save("/workspace/framevane-broadcaster/assets/banner-avatar-check.png")
print("Saved /workspace/framevane-broadcaster/assets/banner-avatar-check.png")
