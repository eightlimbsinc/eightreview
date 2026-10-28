# Regenerates public/voiceover/*.mp3 from lines.json with Kokoro TTS (runs offline).
#   pip install kokoro-onnx soundfile
#   model files: github.com/thewh1teagle/kokoro-onnx/releases (kokoro-v1.0.onnx, voices-v1.0.bin)
#   python voiceover/generate.py path/to/kokoro-v1.0.onnx path/to/voices-v1.0.bin
# After changing a line, check its length still fits the scene in src/Showcase.tsx.
import json, os, subprocess, sys, tempfile
import soundfile as sf
from kokoro_onnx import Kokoro

VOICE = "af_heart"
here = os.path.dirname(os.path.abspath(__file__))
out = os.path.join(here, "..", "public", "voiceover")
kokoro = Kokoro(sys.argv[1], sys.argv[2])
for scene, text in json.load(open(os.path.join(here, "lines.json"))).items():
    samples, rate = kokoro.create(text, voice=VOICE, speed=1.0, lang="en-us")
    with tempfile.NamedTemporaryFile(suffix=".wav") as wav:
        sf.write(wav.name, samples, rate)
        subprocess.run(["npx", "remotion", "ffmpeg", "-y", "-loglevel", "error", "-i", wav.name,
                        "-ac", "1", "-b:a", "96k", os.path.join(out, f"{scene}.mp3")], check=True)
    print(f"{scene}: {len(samples) / rate:.2f}s")
