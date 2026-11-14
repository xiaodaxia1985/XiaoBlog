# -*- coding: utf-8 -*-
# 按站点实际用字重新子集化可变字体，输出 public/fonts/*.woff2。
#
# 前置：源可变字体放在 .cache/fonts-src/（不入库）：
#   NotoSansSC.ttf   来源 google/fonts ofl/notosanssc/NotoSansSC[wght].ttf
#   Inter.ttf        来源 google/fonts ofl/inter/Inter[opsz,wght].ttf
# 缺源字体时先按 docs/后端部署手册或本脚本顶部 URL 下载；本脚本不联网取字体。
#
# 运行（Python 3.12，需 fonttools + brotli）：
#   python scripts/subset-fonts.py
#
# 新增文章用到生僻字后，重跑本脚本即可把新字形并入子集；可变字重轴保持不变。
import os
import shutil
import subprocess
import sys
from fontTools import subset

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, ".cache", "fonts-src")
OUT_DIR = os.path.join(ROOT, "public", "fonts")

TEXT_DIRS = [
    ("src", (".astro", ".mjs", ".ts", ".js")),
    ("src/content/insights", (".md",)),
    ("public/css", (".css",)),
    ("public/js", (".js",)),
    ("src/data", (".mjs",)),
]

# 基线字符区间。Inter 只承载拉丁/数字/西文标点；中文标点、全角与符号一律走 Noto 回退。
BASELINE = {
    "noto-sans-sc.woff2": (
        "U+0020-007E,"
        "U+00A0-00FF,"
        "U+2010-2027,"   # 连字符/引号/省略号
        "U+2190-219F,"   # 箭头
        "U+2200-22FF,"   # 数学符号
        "U+3000-303F,"   # CJK 标点
        "U+FF00-FFEF,"   # 全角字符
    ),
    "inter.woff2": "U+0020-007E,U+00A0-00FF",
}

# 保留的 OpenType 特性；其余特性及其引用的备选字形一并裁掉，控制体积。
LAYOUT_FEATURES = {
    "noto-sans-sc.woff2": "*",
    "inter.woff2": "kern,liga,calt",
}

FONTS = [
    ("NotoSansSC.ttf", "noto-sans-sc.woff2"),
    ("Inter.ttf", "inter.woff2"),
]


def collect_chars():
    chars = set()
    for sub, exts in TEXT_DIRS:
        base = os.path.join(ROOT, sub)
        if not os.path.isdir(base):
            continue
        for dirpath, _, files in os.walk(base):
            for f in files:
                if not f.lower().endswith(exts):
                    continue
                p = os.path.join(dirpath, f)
                try:
                    text = open(p, encoding="utf-8").read()
                except Exception:
                    continue
                chars.update(c for c in text if c.isprintable() and not c.isspace())
    return "".join(sorted(chars))


def main():
    chars = collect_chars()
    chars_file = os.path.join(SRC_DIR, "chars.txt")
    os.makedirs(SRC_DIR, exist_ok=True)
    open(chars_file, "w", encoding="utf-8").write(chars)
    print(f"收集站点用字 {len(chars)} 个 → {chars_file}")

    backup_dir = os.path.join(SRC_DIR, "backup")
    os.makedirs(backup_dir, exist_ok=True)

    for src_name, out_name in FONTS:
        src = os.path.join(SRC_DIR, src_name)
        out = os.path.join(OUT_DIR, out_name)
        if not os.path.exists(src):
            sys.exit(f"缺少源字体：{src}（按脚本注释下载后重试）")

        if os.path.exists(out):
            shutil.copy2(out, os.path.join(backup_dir, out_name))

        args = [
            sys.executable, "-m", "fontTools.subset", src,
            f"--text-file={chars_file}",
            f"--unicodes={BASELINE[out_name]}",
            f"--output-file={out}",
            "--flavor=woff2",
            f"--layout-features={LAYOUT_FEATURES[out_name]}",
            "--layout-closure=false",
            "--no-hinting",
            "--desubroutinize",
            "--drop-tables+=DSIG",
            "--name-IDs=*",
            "--name-legacy",
            "--name-languages=*",
            "--recalc-bounds",
        ]
        print(f"子集化 {src_name} → {out_name}")
        subprocess.run(args, check=True)

    print("完成。可用 .qa/font_audit.py 复核覆盖率。")


if __name__ == "__main__":
    main()
