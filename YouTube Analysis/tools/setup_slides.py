#!/usr/bin/env python3
"""
Builds the report slide template into your Google Slides presentation.
Run once before your first weekly report:
  python tools/setup_slides.py

Re-run any time you want to reset the template.
"""
import os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv
load_dotenv(ROOT / '.env')

PRESENTATION_ID = os.getenv('PRESENTATION_ID', '')
TOKEN_PATH = ROOT / 'token.json'

SCOPES = [
    'https://www.googleapis.com/auth/presentations',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/drive.file',
]

# Slide dimensions (EMU — Google's unit, 914400 per inch)
W = 9144000   # 10 inches wide
H = 5143500   # 5.625 inches tall

MARGIN  = 457200   # 0.5"
GAP     = 80000
COL_W   = (W - 2 * MARGIN - 3 * GAP) // 4   # 4 equal columns
COLS    = [MARGIN + i * (COL_W + GAP) for i in range(4)]

def emu(inch): return int(inch * 914400)
def rgb(h):
    h = h.lstrip('#')
    return {'red': int(h[0:2],16)/255, 'green': int(h[2:4],16)/255, 'blue': int(h[4:6],16)/255}

# ── Request builders ───────────────────────────────────────────────────────────
def textbox(obj_id, page_id, text, x, y, w, h,
            size=18, bold=False, italic=False, color='e2e2f0', align='LEFT'):
    return [
        {'createShape': {
            'objectId': obj_id, 'shapeType': 'TEXT_BOX',
            'elementProperties': {
                'pageObjectId': page_id,
                'size':      {'width': {'magnitude': w, 'unit': 'EMU'}, 'height': {'magnitude': h, 'unit': 'EMU'}},
                'transform': {'scaleX': 1, 'scaleY': 1, 'translateX': x, 'translateY': y, 'unit': 'EMU'},
            },
        }},
        {'insertText': {'objectId': obj_id, 'insertionIndex': 0, 'text': text}},
        {'updateTextStyle': {
            'objectId': obj_id, 'textRange': {'type': 'ALL'},
            'style': {
                'bold': bold, 'italic': italic,
                'fontSize': {'magnitude': size, 'unit': 'PT'},
                'foregroundColor': {'opaqueColor': {'rgbColor': rgb(color)}},
            },
            'fields': 'bold,italic,fontSize,foregroundColor',
        }},
        {'updateParagraphStyle': {
            'objectId': obj_id, 'textRange': {'type': 'ALL'},
            'style': {'alignment': {'LEFT': 'START', 'RIGHT': 'END'}.get(align, align)},
            'fields': 'alignment',
        }},
    ]

def block(obj_id, page_id, x, y, w, h, color='6366f1'):
    return [
        {'createShape': {
            'objectId': obj_id, 'shapeType': 'RECTANGLE',
            'elementProperties': {
                'pageObjectId': page_id,
                'size':      {'width': {'magnitude': w, 'unit': 'EMU'}, 'height': {'magnitude': h, 'unit': 'EMU'}},
                'transform': {'scaleX': 1, 'scaleY': 1, 'translateX': x, 'translateY': y, 'unit': 'EMU'},
            },
        }},
        {'updateShapeProperties': {
            'objectId': obj_id,
            'shapeProperties': {
                'shapeBackgroundFill': {'solidFill': {'color': {'rgbColor': rgb(color)}}},
                'outline': {'propertyState': 'NOT_RENDERED'},
            },
            'fields': 'shapeBackgroundFill,outline.propertyState',
        }},
    ]

def slide_bg(page_id, color):
    return {'updatePageProperties': {
        'objectId': page_id,
        'pageProperties': {'pageBackgroundFill': {'solidFill': {'color': {'rgbColor': rgb(color)}}}},
        'fields': 'pageBackgroundFill',
    }}

# ── Slide 1: Cover ─────────────────────────────────────────────────────────────
def build_cover(sid):
    reqs = [
        {'createSlide': {
            'objectId': sid, 'insertionIndex': 0,
            'slideLayoutReference': {'predefinedLayout': 'BLANK'},
        }},
        slide_bg(sid, '080810'),
    ]
    # Bottom accent bar
    reqs += block(f'{sid}_bar', sid, 0, H - 280000, W, 280000, '6366f1')
    # Small indigo label
    reqs += textbox(f'{sid}_lbl', sid,
        'YOUTUBE CHANNEL REPORT',
        x=MARGIN, y=600000, w=W - 2*MARGIN, h=380000,
        size=11, bold=True, color='6366f1', align='CENTER')
    # Channel name placeholder — large
    reqs += textbox(f'{sid}_ch', sid,
        '{{CHANNEL_NAME}}',
        x=MARGIN, y=1100000, w=W - 2*MARGIN, h=1500000,
        size=56, bold=True, color='e2e2f0', align='CENTER')
    # Date
    reqs += textbox(f'{sid}_date', sid,
        '{{REPORT_DATE}}',
        x=MARGIN, y=2800000, w=W - 2*MARGIN, h=400000,
        size=18, color='7e7ea8', align='CENTER')
    # Tagline
    reqs += textbox(f'{sid}_tag', sid,
        'Weekly Performance Report',
        x=MARGIN, y=3300000, w=W - 2*MARGIN, h=350000,
        size=13, italic=True, color='4b4b6b', align='CENTER')
    return reqs

# ── Slide 2: Metrics ────────────────────────────────────────────────────────────
def build_metrics(sid):
    reqs = [
        {'createSlide': {
            'objectId': sid, 'insertionIndex': 1,
            'slideLayoutReference': {'predefinedLayout': 'BLANK'},
        }},
        slide_bg(sid, '0d0d18'),
    ]
    # Top accent bar
    reqs += block(f'{sid}_topbar', sid, 0, 0, W, 110000, '6366f1')
    # Section title
    reqs += textbox(f'{sid}_title', sid,
        'CHANNEL PERFORMANCE',
        x=MARGIN, y=170000, w=W//2, h=400000,
        size=11, bold=True, color='6366f1', align='LEFT')
    # Channel name (left)
    reqs += textbox(f'{sid}_ch', sid,
        '{{CHANNEL_NAME}}',
        x=MARGIN, y=650000, w=emu(5.5), h=480000,
        size=24, bold=True, color='e2e2f0', align='LEFT')
    # Date (right)
    reqs += textbox(f'{sid}_date', sid,
        '{{REPORT_DATE}}',
        x=W//2, y=650000, w=W//2 - MARGIN, h=480000,
        size=14, color='4b4b6b', align='RIGHT')
    # Divider
    reqs += block(f'{sid}_div', sid, MARGIN, 1270000, W - 2*MARGIN, 16000, '1e1e32')

    # 4 stat columns
    labels = ['TOTAL VIEWS',    'SUBSCRIBERS',    'TOTAL VIDEOS',    'AVG VIEWS / VIDEO']
    values = ['{{TOTAL_VIEWS}}','{{SUBSCRIBERS}}','{{TOTAL_VIDEOS}}','{{AVG_VIEWS}}']
    ids    = ['tv', 'sb', 'vi', 'av']

    for col_x, label, value, vid in zip(COLS, labels, values, ids):
        # Card bg
        reqs += block(f'{sid}_card_{vid}', sid,
            col_x - 30000, 1360000, COL_W + 60000, 2600000, '0f0f1a')
        # Accent dot
        reqs += block(f'{sid}_dot_{vid}', sid,
            col_x, 1480000, 90000, 90000, '6366f1')
        # Label
        reqs += textbox(f'{sid}_lbl_{vid}', sid,
            label,
            x=col_x, y=1660000, w=COL_W, h=300000,
            size=9, bold=True, color='4b4b6b', align='LEFT')
        # Value
        reqs += textbox(f'{sid}_val_{vid}', sid,
            value,
            x=col_x, y=2020000, w=COL_W, h=900000,
            size=38, bold=True, color='e2e2f0', align='LEFT')

    # Bottom bar
    reqs += block(f'{sid}_botbar', sid, 0, H - 230000, W, 230000, '080810')
    reqs += textbox(f'{sid}_footer', sid,
        'Generated by YT Analyst  ·  youtube-analysis-499500',
        x=MARGIN, y=H - 200000, w=W - 2*MARGIN, h=180000,
        size=8, color='4b4b6b', align='CENTER')
    return reqs

# ── Main builder ───────────────────────────────────────────────────────────────
def build_template(creds, presentation_id):
    from googleapiclient.discovery import build
    svc = build('slides', 'v1', credentials=creds)

    pres         = svc.presentations().get(presentationId=presentation_id).execute()
    existing_ids = [s['objectId'] for s in pres.get('slides', [])]

    requests = []
    for sid in existing_ids:
        requests.append({'deleteObject': {'objectId': sid}})
    requests += build_cover('yt_cover')
    requests += build_metrics('yt_metrics')

    svc.presentations().batchUpdate(
        presentationId=presentation_id,
        body={'requests': requests}
    ).execute()

    return f'https://docs.google.com/presentation/d/{presentation_id}'

# ── Auth (reuses token.json) ───────────────────────────────────────────────────
def get_credentials():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            secrets = list(ROOT.glob('client_secret_*.json'))
            if not secrets:
                print('Error: No client_secret_*.json found'); sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(str(secrets[0]), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json())
    return creds

def main():
    if not PRESENTATION_ID:
        print('\n  Error: PRESENTATION_ID not set in .env\n'); sys.exit(1)

    print(f'\n  Building slide template...')
    creds = get_credentials()
    url = build_template(creds, PRESENTATION_ID)
    print(f'  ✓  Template applied')
    print(f'  →  {url}\n')

if __name__ == '__main__':
    main()
