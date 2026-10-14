import os
from PIL import Image, ImageDraw

def create_icon(size, output_path):
    # Create image with dark gradient-like background
    img = Image.new("RGBA", (size, size), (4, 6, 12, 255))
    draw = ImageDraw.Draw(img)

    scale = size / 512.0
    radius = int(100 * scale)

    # Rounded rectangle background
    draw.rounded_rectangle([(0, 0), (size - 1, size - 1)], radius=radius, fill=(10, 16, 29, 255), outline=(56, 196, 224, 60), width=max(1, int(4 * scale)))

    # Grid line
    draw.line([(int(40 * scale), int(256 * scale)), (int(472 * scale), int(256 * scale))], fill=(56, 196, 224, 25), width=max(1, int(2 * scale)))
    draw.line([(int(256 * scale), int(40 * scale)), (int(256 * scale), int(472 * scale))], fill=(56, 196, 224, 25), width=max(1, int(2 * scale)))

    # Wave points
    points = [
        (64 * scale, 300 * scale),
        (160 * scale, 300 * scale),
        (210 * scale, 160 * scale),
        (290 * scale, 380 * scale),
        (350 * scale, 160 * scale),
        (390 * scale, 250 * scale),
        (448 * scale, 250 * scale),
    ]

    # Draw glow line
    glow_width = max(2, int(34 * scale))
    line_width = max(2, int(24 * scale))
    draw.line(points, fill=(56, 196, 224, 90), width=glow_width, joint="curve")
    draw.line(points, fill=(47, 224, 138, 255), width=line_width, joint="curve")

    # Corner status beacon
    cx, cy = int(410 * scale), int(130 * scale)
    r1 = int(22 * scale)
    r2 = int(12 * scale)
    draw.ellipse([(cx - r1, cy - r1), (cx + r1, cy + r1)], fill=(47, 224, 138, 220))
    draw.ellipse([(cx - r2, cy - r2), (cx + r2, cy + r2)], fill=(255, 255, 255, 255))

    img.save(output_path, "PNG")
    print(f"Saved {output_path} ({size}x{size})")

out_dir = os.path.join(os.path.dirname(__file__), "..", "public")
create_icon(192, os.path.join(out_dir, "icon-192.png"))
create_icon(512, os.path.join(out_dir, "icon-512.png"))
create_icon(180, os.path.join(out_dir, "apple-touch-icon.png"))
create_icon(64, os.path.join(out_dir, "favicon-64.png"))
