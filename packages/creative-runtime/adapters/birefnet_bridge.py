"""Pinned BiRefNet inference bridge (P2a follow-up).

Fixed entry point for the segmentation worker. Takes ONLY validated
scalars (paths checked for existence/shape, size/device from
allowlists); performs no network access, and emits exactly one JSON
line on stdout. Any failure exits non-zero with a one-line stderr
message. torch + BiRefNet code + weights are deployment-provisioned
(never bundled by this repo).

Security property: fixed entry point + trusted revision/hash-pinned
code. Importing the deployment-provisioned BiRefNet modules DOES
execute that code, so the worker verifies the code manifest and
weights hash BEFORE spawning this bridge; this file itself runs no
dynamic imports beyond the pinned torch/PIL/torchvision/safetensors
packages.
"""
import argparse
import hashlib
import json
import sys
import time

ALLOWED_SIZES = (512, 768, 1024)
ALLOWED_DEVICES = ("cpu", "cuda")


def fail(message):
    sys.stderr.write("birefnet_bridge_failed:%s\n" % str(message)[:300])
    raise SystemExit(2)


def main():
    parser = argparse.ArgumentParser(prog="birefnet_bridge")
    parser.add_argument("--code-dir", required=True)
    parser.add_argument("--weights", required=True)
    parser.add_argument("--input", required=True)
    parser.add_argument("--output-mask", required=True)
    parser.add_argument("--size", required=True)
    parser.add_argument("--device", required=True)
    args = parser.parse_args()

    try:
        size = int(args.size)
    except ValueError:
        fail("bad size")
    if size not in ALLOWED_SIZES:
        fail("size allowlist")
    if args.device not in ALLOWED_DEVICES:
        fail("device allowlist")
    for label, path in (("code-dir", args.code_dir), ("weights", args.weights), ("input", args.input)):
        if not path or len(path) > 512 or "\0" in path:
            fail("bad path %s" % label)
    if not args.output_mask or len(args.output_mask) > 512 or "\0" in args.output_mask:
        fail("bad output path")

    sys.path.insert(0, args.code_dir)
    try:
        import torch
        from PIL import Image
        from torchvision import transforms
        from safetensors.torch import load_file as load_safetensors
        from models.birefnet import BiRefNet
        from utils import check_state_dict
    except ImportError as error:
        fail("imports unavailable: %s" % error)

    if args.device == "cuda" and not torch.cuda.is_available():
        fail("cuda unavailable")

    # Format-faithful load: the selected artifact is model.safetensors.
    # Anything else (pickle .pt/.bin, garbage) is rejected here — the
    # legacy torch.load path is never used, so a pickle can neither
    # execute nor load.
    if not args.weights.lower().endswith(".safetensors"):
        fail("weights must be a .safetensors artifact")
    try:
        with open(args.weights, "rb") as probe:
            header = probe.read(8)
        if len(header) < 8 or int.from_bytes(header, "little") <= 0:
            fail("weights header malformed")
    except Exception as error:
        fail("weights unreadable: %s" % error)

    try:
        image = Image.open(args.input).convert("RGB")
    except Exception as error:
        fail("unreadable input: %s" % error)
    source_size = image.size

    transform = transforms.Compose([
        transforms.Resize((size, size)),
        transforms.ToTensor(),
        transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
    ])
    try:
        net = BiRefNet(bb_pretrained=False)
        state_dict = load_safetensors(args.weights, device=args.device)
        net.load_state_dict(check_state_dict(state_dict))
        net.to(args.device)
        net.eval()
    except Exception as error:
        fail("model load failed: %s" % error)

    started = time.time()
    try:
        with torch.no_grad():
            pred = net(transform(image).unsqueeze(0).to(args.device))[-1].sigmoid().cpu()
    except Exception as error:
        fail("inference failed: %s" % error)
    infer_ms = int((time.time() - started) * 1000)
    mask = transforms.ToPILImage()(pred[0].squeeze()).resize(source_size)
    try:
        mask.save(args.output_mask)
    except Exception as error:
        fail("mask write failed: %s" % error)
    with open(args.output_mask, "rb") as handle:
        digest = hashlib.sha256(handle.read()).hexdigest()
    sys.stdout.write(json.dumps({
        "mask_sha256": digest,
        "width": source_size[0],
        "height": source_size[1],
        "infer_ms": infer_ms,
        "device": args.device,
    }) + "\n")


if __name__ == "__main__":
    main()
