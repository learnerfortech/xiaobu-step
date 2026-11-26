"""Read one local notebook image with installed models. Stdout is reserved for JSON."""
import contextlib
import json
import os
import sys
from pathlib import Path

def recognize(image):
    cache = Path.home() / '.cache/xiaobu-paddle'
    detector = cache / 'PP-OCRv5_mobile_det'
    recognizer = cache / 'PP-OCRv5_mobile_rec'
    if not all((model / 'inference.yml').is_file() for model in (detector, recognizer)):
        raise FileNotFoundError('missing local OCR models')
    os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
    os.environ['HF_HUB_OFFLINE'] = '1'
    from paddleocr import PaddleOCR
    engine = PaddleOCR(device='cpu', cpu_threads=4, enable_mkldnn=False,
                       text_detection_model_dir=str(detector), text_recognition_model_dir=str(recognizer),
                       text_detection_model_name=detector.name, text_recognition_model_name=recognizer.name,
                       use_doc_orientation_classify=False, use_doc_unwarping=False,
                       use_textline_orientation=False)
    lines = []
    for page in engine.predict(str(image)):
        lines.extend(line.strip() for line in page['rec_texts'] if line.strip())
    return '\n'.join(lines)

if __name__ == '__main__':
    with contextlib.redirect_stdout(sys.stderr):
        text = recognize(Path(sys.argv[1]))
    print(json.dumps({'text': text, 'engine': 'paddle'}, ensure_ascii=False))
