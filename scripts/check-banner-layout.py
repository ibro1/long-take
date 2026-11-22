from PIL import Image

for name in ["x-banner-v1-midnight.png", "x-banner-v2-obsidian.png", "x-banner-v3-espresso.png"]:
    im = Image.open(f"/workspace/framevane-broadcaster/assets/{name}")
    print(name, im.size, im.mode)
