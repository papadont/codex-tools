from pathlib import Path
from PIL import Image
import json


SRC = Path("/Users/hideki/Documents/kiro/webp/puchi-dv.png")
RUN_DIR = Path("/Users/hideki/Documents/develop/codex-tools/pet-runs/puchi-dv")
FINAL_DIR = RUN_DIR / "final"
QA_DIR = RUN_DIR / "qa"
PET_DIR = Path.home() / ".codex" / "pets" / "puchi-dv"

CELL_W, CELL_H = 192, 208
ATLAS_W, ATLAS_H = CELL_W * 8, CELL_H * 9

# Source sheet geometry. The source is a contact-sheet-style drawing; the
# rectangular frame itself is the pet body.
FRAME_W, FRAME_H = 140, 96
XS = [169, 314, 459, 606, 751, 897, 1041, 1185]
YS = [42, 165, 289, 411, 534, 656, 779, 900, 1023]

ROWS = [
    ("idle", [0, 1, 2, 3, 4, 5]),
    ("running-right", [0, 1, 2, 3, 4, 5, 6, 5]),
    ("running-left", [0, 1, 2, 3, 4, 5, 6, 5]),
    ("waving", [0, 1, 2, 3]),
    ("jumping", [0, 1, 2, 3, 0]),
    ("failed", [0, 1, 2, 3, 4, 5, 6, 5]),
    ("waiting", [0, 1, 2, 3, 4, 3]),
    ("running", [0, 1, 2, 3, 4, 3]),
    ("review", [0, 1, 2, 3, 4, 3]),
]


def is_checker_or_near_white(r, g, b):
    # The source has a baked checkerboard. Keep the hand-drawn gray/black line
    # tones; only normalize the pale background tiles to pure white.
    return r >= 225 and g >= 225 and b >= 225 and max(r, g, b) - min(r, g, b) <= 8


def clean_frame(src, x, y):
    crop = src.crop((x, y, x + FRAME_W, y + FRAME_H)).convert("RGBA")
    px = crop.load()
    for yy in range(FRAME_H):
        for xx in range(FRAME_W):
            r, g, b, a = px[xx, yy]
            if is_checker_or_near_white(r, g, b):
                px[xx, yy] = (255, 255, 255, 255)
            else:
                px[xx, yy] = (r, g, b, 255)
    return crop


def compose():
    src = Image.open(SRC).convert("RGB")
    atlas = Image.new("RGBA", (ATLAS_W, ATLAS_H), (0, 0, 0, 0))
    frames = {}

    for row_i, (state, source_indices) in enumerate(ROWS):
        frames[state] = len(source_indices)
        for col_i, source_col in enumerate(source_indices):
            frame = clean_frame(src, XS[source_col], YS[row_i])
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

    preview_dir = QA_DIR / "previews"
    preview_dir.mkdir(parents=True, exist_ok=True)
    for row_i, (state, source_indices) in enumerate(ROWS):
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
        "description": "A hand-drawn framed expression pet with white panel interiors and transparent outside space.",
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
        "notes": "Black frame is treated as the pet body; pale checkerboard inside each frame is normalized to white; outside each frame is transparent. Hand-drawn line tone is preserved.",
    }
    (RUN_DIR / "pet_request.json").write_text(json.dumps(request, ensure_ascii=False, indent=2) + "\n")
    summary = {
        "ok": True,
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
