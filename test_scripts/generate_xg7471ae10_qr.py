"""Generate a QR code whose payload is ``XG7471AE10``."""

from __future__ import annotations

import argparse
from pathlib import Path

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_M
except ModuleNotFoundError as exc:
    requirements = Path(__file__).with_name("requirements.txt")
    raise SystemExit(
        "缺少二维码依赖，请先运行：\n"
        f'python -m pip install -r "{requirements}"'
    ) from exc


QR_CONTENT = "XG7471AE10"
DEFAULT_OUTPUT = Path(__file__).with_name(f"{QR_CONTENT}.png")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=f"生成内容为 {QR_CONTENT} 的二维码 PNG 图片。"
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"输出文件路径，默认为 {DEFAULT_OUTPUT}",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_M,
        box_size=12,
        border=4,
    )
    qr.add_data(QR_CONTENT)
    qr.make(fit=True)

    image = qr.make_image(fill_color="black", back_color="white")
    image.save(output)
    print(f"二维码已生成：{output}")
    print(f"二维码内容：{QR_CONTENT}")


if __name__ == "__main__":
    main()
