from pathlib import Path
from PIL import Image, ImageDraw
import json
import subprocess
import sys


SRC = Path("/Users/hideki/Documents/kiro/webp/puchi-dv.png")
RUN_DIR = Path("/Users/hideki/Documents/develop/codex-tools/pet-runs/puchi-dv")
FINAL_DIR = RUN_DIR / "final"
QA_DIR = RUN_DIR / "qa"
PET_DIR = Path.home() / ".codex" / "pets" / "puchi-dv"
VALIDATOR = Path.home() / ".codex" / "skills" / "hatch-pet" / "scripts" / "validate_atlas.py"

CELL_W, CELL_H = 192, 208
ATLAS_W, ATLAS_H = CELL_W * 8, CELL_H * 9

# Source sheet geometry. The source is a contact-sheet-style drawing. The
# extracted expression panel becomes the pet body.
FRAME_W, FRAME_H = 140, 96
CORNER_RADIUS = 11
XS = [169, 314, 459, 606, 751, 897, 1041, 1185]
YS = [42, 165, 289, 411, 534, 656, 779, 900, 1023]

ROWS = [
    # Idle intentionally reuses the waiting row for a slightly bored look.
    ("idle", 6, [0, 1, 2, 3, 4, 3]),
    ("running-right", 1, [0, 1, 2, 3, 4, 5, 6, 5]),
    ("running-left", 2, [0, 1, 2, 3, 4, 5, 6, 5]),
    ("waving", 3, [0, 1, 2, 3]),
    # The app's hover uses the jumping row; keep the surprised hover look in
    # the five contract-valid cells and leave the remaining cells transparent.
    ("jumping", 4, [0, 1, 2, 3, 0]),
    ("failed", 5, [0, 1, 2, 3, 4, 5, 6, 5]),
    ("waiting", 6, [0, 1, 2, 3, 4, 3]),
    ("running", 7, [0, 1, 2, 3, 4, 3]),
    ("review", 8, [0, 1, 2, 3, 4, 3]),
]


def is_checker_or_near_white(r, g, b):
    # The source has a baked checkerboard. Keep the hand-drawn gray/black line
    # tones; only normalize the pale background tiles to pure white.
    return r >= 225 and g >= 225 and b >= 225 and max(r, g, b) - min(r, g, b) <= 8


def is_expression_line(r, g, b):
    # Preserve the original hand-drawn line tone, including soft gray strokes.
    return max(r, g, b) < 225


def is_old_frame_border(xx, yy):
    return xx <= 4 or yy <= 4 or xx >= FRAME_W - 5 or yy >= FRAME_H - 5


def clean_frame(src, x, y):
    crop = src.crop((x, y, x + FRAME_W, y + FRAME_H)).convert("RGB")
    frame = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    mask = Image.new("L", (FRAME_W, FRAME_H), 0)
    mask_draw = ImageDraw.Draw(mask)
    mask_draw.rounded_rectangle(
        (0, 0, FRAME_W - 1, FRAME_H - 1),
        radius=CORNER_RADIUS,
        fill=255,
    )

    # White rounded rectangle body, with no black outline.
    body = Image.new("RGBA", (FRAME_W, FRAME_H), (255, 255, 255, 255))
    frame.alpha_composite(Image.composite(body, frame, mask))

    src_px = crop.load()
    out_px = frame.load()
    mask_px = mask.load()
    for yy in range(FRAME_H):
        for xx in range(FRAME_W):
            if not mask_px[xx, yy] or is_old_frame_border(xx, yy):
                continue
            r, g, b = src_px[xx, yy]
            if is_expression_line(r, g, b) and not is_checker_or_near_white(r, g, b):
                out_px[xx, yy] = (r, g, b, 255)
    return frame


def checker(size, square=16):
    image = Image.new("RGB", size, "#ffffff")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], square):
        for x in range(0, size[0], square):
            if (x // square + y // square) % 2:
                draw.rectangle((x, y, x + square - 1, y + square - 1), fill="#e8e8e8")
    return image


def write_contact_sheet(atlas, output, *, scale=0.5, hover_label=False):
    label_h = 22
    cell_w = max(1, round(CELL_W * scale))
    cell_h = max(1, round(CELL_H * scale))
    width = 8 * cell_w
    height = len(ROWS) * (cell_h + label_h)
    sheet = Image.new("RGB", (width, height), "#f7f7f7")
    draw = ImageDraw.Draw(sheet)

    for row_i, (state, _source_row, source_indices) in enumerate(ROWS):
        used_count = len(source_indices)
        y = row_i * (cell_h + label_h)
        label = f"{state} / hover" if hover_label and state == "jumping" else state
        draw.rectangle((0, y, width, y + label_h - 1), fill="#111111")
        draw.text((6, y + 5), f"row {row_i} {label}", fill="#ffffff")
        draw.text((width - 92, y + 5), f"{used_count} frames", fill="#ffffff")

        for col_i in range(8):
            cell = atlas.crop(
                (
                    col_i * CELL_W,
                    row_i * CELL_H,
                    (col_i + 1) * CELL_W,
                    (row_i + 1) * CELL_H,
                )
            ).resize((cell_w, cell_h), Image.Resampling.LANCZOS)
            bg = checker((cell_w, cell_h))
            bg.paste(cell, (0, 0), cell)
            x = col_i * cell_w
            sheet.paste(bg, (x, y + label_h))
            outline = "#18a058" if col_i < used_count else "#cc3344"
            draw.rectangle((x, y + label_h, x + cell_w - 1, y + label_h + cell_h - 1), outline=outline)
            draw.text((x + 4, y + label_h + 4), str(col_i), fill="#111111")

    sheet.save(output)


def validate(spritesheet_webp):
    validation_json = FINAL_DIR / "validation.json"
    if not VALIDATOR.exists():
        result = {
            "ok": False,
            "file": str(spritesheet_webp),
            "errors": [f"validator not found: {VALIDATOR}"],
            "warnings": [],
        }
        validation_json.write_text(json.dumps(result, indent=2) + "\n")
        return result

    subprocess.run(
        [sys.executable, str(VALIDATOR), str(spritesheet_webp), "--json-out", str(validation_json)],
        check=False,
    )
    return json.loads(validation_json.read_text())


def compose():
    src = Image.open(SRC).convert("RGB")
    atlas = Image.new("RGBA", (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
    frames = {}

    for row_i, (state, source_row, source_indices) in enumerate(ROWS):
        frames[state] = len(source_indices)
        for col_i, source_ref in enumerate(source_indices):
            if isinstance(source_ref, tuple):
                frame_source_row, source_col = source_ref
            else:
                frame_source_row, source_col = source_row, source_ref
            frame = clean_frame(src, XS[source_col], YS[frame_source_row])
            x = col_i * CELL_W + (CELL_W - FRAME_W) // 2
            y = row_i * CELL_H + (CELL_H - FRAME_H) // 2
            atlas.alpha_composite(frame, (x, y))

    FINAL_DIR.mkdir(parents=True, exist_ok=True)
    QA_DIR.mkdir(parents=True, exist_ok=True)
    PET_DIR.mkdir(parents=True, exist_ok=True)

    spritesheet_png = FINAL_DIR / "spritesheet.png"
    spritesheet_webp = FINAL_DIR / "spritesheet.webp"
    atlas.save(spritesheet_png)
    atlas.save(spritesheet_webp, lossless=True, quality=100, method=6)
    atlas.save(PET_DIR / "spritesheet.webp", lossless=True, quality=100, method=6)

    write_contact_sheet(atlas, QA_DIR / "contact-sheet.png", scale=0.5)
    write_contact_sheet(atlas, QA_DIR / "contact-sheet-hover.png", scale=0.604, hover_label=True)

    preview_dir = QA_DIR / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    for row_i, (state, source_row, source_indices) in enumerate(ROWS):
        gif_frames = []
        for col_i in range(len(source_indices)):
            cell = atlas.crop(
                (
                    col_i * CELL_W,
                    row_i * CELL_H,
                    (col_i + 1) * CELL_W,
                    (row_i + 1) * CELL_H,
                )
            )
            gif_frames.append(cell)
        gif_frames[0].save(
            preview_dir / f"{state}.gif",
            save_all=True,
            append_images=gif_frames[1:],
            duration=130,
            loop=0,
            disposal=2,
        )

    pet_json = {
        "id": "puchi-dv",
        "displayName": "puchi-dv",
        "description": "A hand-drawn rounded expression panel pet with white interiors and transparent outside space.",
        "spritesheetPath": "spritesheet.webp",
    }
    (PET_DIR / "pet.json").write_text(json.dumps(pet_json, ensure_ascii=False, indent=2) + "\n")

    request = {
        "pet_id": "puchi-dv",
        "display_name": "puchi-dv",
        "source": str(SRC),
        "cell_size": [CELL_W, CELL_H],
        "atlas_size": [ATLAS_W, ATLAS_H],
        "frame_size": [FRAME_W, FRAME_H],
        "states": frames,
        "notes": "The old black frame is removed. A white rounded rectangle is treated as the pet body; outside the rounded panel is transparent. Idle reuses the bored waiting row. The fifth row keeps the surprised hover frames in the five contract-valid jumping cells. Hand-drawn expression line tone is preserved.",
    }
    (RUN_DIR / "pet_request.json").write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n")
    validation = validate(spritesheet_webp)
    summary = {
        "ok": bool(validation.get("ok")),
        "run_dir": str(RUN_DIR),
        "spritesheet": str(spritesheet_webp),
        "contact_sheet": str(QA_DIR / "contact-sheet.png"),
        "validation": str(FINAL_DIR / "validation.json"),
        "package": str(PET_DIR),
    }
    (QA_DIR / "run-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n")
    return spritesheet_webp


if __name__ == "__main__":
    print(compose())
