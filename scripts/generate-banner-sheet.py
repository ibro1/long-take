from PIL import Image

im1 = Image.open("/workspace/framevane-broadcaster/assets/x-banner-v1-midnight.png")
im2 = Image.open("/workspace/framevane-broadcaster/assets/x-banner-v2-obsidian.png")
im3 = Image.open("/workspace/framevane-broadcaster/assets/x-banner-v3-espresso.png")

# Scale down to 750x250 each and stack vertically
w, h = 750, 250
im1_s = im1.resize((w, h), Image.Resampling.LANCZOS)
im2_s = im2.resize((w, h), Image.Resampling.LANCZOS)
im3_s = im3.resize((w, h), Image.Resampling.LANCZOS)

sheet = Image.new("RGBA", (w, h * 3 + 20), (10, 12, 16, 255))
sheet.paste(im1_s, (0, 0))
sheet.paste(im2_s, (0, h + 10))
sheet.paste(im3_s, (0, (h + 10) * 2))

sheet.save("/workspace/framevane-broadcaster/assets/x-banner-sheet.png")
print("Saved sheet to /workspace/framevane-broadcaster/assets/x-banner-sheet.png")
