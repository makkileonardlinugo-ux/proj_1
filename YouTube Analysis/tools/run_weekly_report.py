#!/usr/bin/env python3
"""
Weekly YouTube Analysis Report
--------------------------------
Run:  python tools/run_weekly_report.py
      python tools/run_weekly_report.py --channel @mkbhd
      python tools/run_weekly_report.py --channel @mkbhd --weeks 2

First run opens a browser once for Google authorization.
Every run after that is fully headless — no pop-ups, no manual steps.
Sheets and Slides are auto-created if IDs are missing from .env.
"""
import os, sys, re, glob, base64, argparse
from datetime import datetime, timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv, set_key
load_dotenv(ROOT / '.env')

YOUTUBE_API_KEY = os.getenv('YOUTUBE_API_KEY')
RECIPIENT_EMAIL = os.getenv('RECIPIENT_EMAIL')
SENDER_EMAIL    = os.getenv('SENDER_EMAIL')
YOUTUBE_CHANNEL = os.getenv('YOUTUBE_CHANNEL', '')

SPREADSHEET_ID  = os.getenv('SPREADSHEET_ID', '')
PRESENTATION_ID = os.getenv('PRESENTATION_ID', '')

TOKEN_PATH  = ROOT / 'token.json'
ENV_PATH    = ROOT / '.env'

SCOPES = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/presentations',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/drive.file',
]

# ── Terminal output ────────────────────────────────────────────────────────────
G = '\033[92m'; R = '\033[91m'; Y = '\033[93m'; B = '\033[94m'; X = '\033[0m'; D = '\033[2m'

def ok(step, msg):   print(f'  {G}✓{X}  {B}{step:<10}{X} {msg}')
def fail(step, msg): print(f'  {R}✗{X}  {B}{step:<10}{X} {msg}'); sys.exit(1)
def info(msg):       print(f'  {D}→{X}  {msg}')
def warn(msg):       print(f'  {Y}!{X}  {msg}')
def hr():            print(f'  {"─" * 56}')

# ── Auth ───────────────────────────────────────────────────────────────────────
def get_credentials():
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request

    creds = None
    if TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_PATH), SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            info('Refreshing token silently...')
            creds.refresh(Request())
        else:
            secrets = list(ROOT.glob('client_secret_*.json'))
            if not secrets:
                fail('auth', 'No client_secret_*.json found in project root')
            warn('First-time setup: browser will open for Google authorization.')
            warn('This only happens once. All future runs are headless.\n')
            flow = InstalledAppFlow.from_client_secrets_file(str(secrets[0]), SCOPES)
            creds = flow.run_local_server(port=0)
        TOKEN_PATH.write_text(creds.to_json())

    ok('auth', 'Credentials ready')
    return creds

# ── Auto-create Sheet ──────────────────────────────────────────────────────────
def ensure_spreadsheet(creds):
    global SPREADSHEET_ID
    if SPREADSHEET_ID:
        return SPREADSHEET_ID
    from googleapiclient.discovery import build
    info('No SPREADSHEET_ID — creating a new Google Sheet...')
    svc   = build('sheets', 'v4', credentials=creds)
    sheet = svc.spreadsheets().create(body={
        'properties': {'title': f'YT Analyst — {datetime.now().strftime("%Y-%m-%d")}'},
        'sheets':     [{'properties': {'title': 'Sheet1'}}],
    }).execute()
    SPREADSHEET_ID = sheet['spreadsheetId']
    set_key(str(ENV_PATH), 'SPREADSHEET_ID', SPREADSHEET_ID)
    ok('setup', f'Sheet created → https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}')
    return SPREADSHEET_ID

# ── Auto-create Slides ─────────────────────────────────────────────────────────
def ensure_presentation(creds):
    global PRESENTATION_ID
    if PRESENTATION_ID:
        return PRESENTATION_ID
    from googleapiclient.discovery import build
    from setup_slides import build_template
    info('No PRESENTATION_ID — creating a new Google Slides presentation...')
    svc  = build('slides', 'v1', credentials=creds)
    pres = svc.presentations().create(body={
        'title': f'YT Analyst Report — {datetime.now().strftime("%Y-%m-%d")}',
    }).execute()
    PRESENTATION_ID = pres['presentationId']
    set_key(str(ENV_PATH), 'PRESENTATION_ID', PRESENTATION_ID)
    info('Building slide template...')
    build_template(creds, PRESENTATION_ID)
    ok('setup', f'Slides created → https://docs.google.com/presentation/d/{PRESENTATION_ID}')
    return PRESENTATION_ID

# ── YouTube fetch ──────────────────────────────────────────────────────────────
def extract_channel_id(raw):
    raw = raw.strip()
    if re.match(r'^UC[\w-]{22}$', raw):
        return raw
    m = re.search(r'@([\w.-]+)', raw)
    if m: return f'@{m.group(1)}'
    m = re.search(r'/channel/(UC[\w-]{22})', raw)
    if m: return m.group(1)
    return raw

def fetch_youtube_data(channel_input, max_results, start_date, end_date):
    from googleapiclient.discovery import build
    youtube    = build('youtube', 'v3', developerKey=YOUTUBE_API_KEY)
    channel_id = extract_channel_id(channel_input)

    if channel_id.startswith('@'):
        info(f'Resolving {channel_id}...')
        r = youtube.search().list(part='snippet', q=channel_id, type='channel', maxResults=1).execute()
        if not r.get('items'):
            raise ValueError(f'Channel not found: {channel_id}')
        channel_id = r['items'][0]['snippet']['channelId']

    ch = youtube.channels().list(part='snippet,statistics', id=channel_id).execute()
    if not ch.get('items'):
        raise ValueError(f'Channel ID not found: {channel_id}')

    channel = ch['items'][0]
    stats   = channel['statistics']
    snippet = channel['snippet']

    params = {
        'part': 'snippet', 'channelId': channel_id,
        'maxResults': min(int(max_results), 50), 'order': 'date', 'type': 'video',
    }
    if start_date: params['publishedAfter']  = f'{start_date}T00:00:00Z'
    if end_date:   params['publishedBefore'] = f'{end_date}T23:59:59Z'

    sr     = youtube.search().list(**params).execute()
    ids    = [i['id']['videoId'] for i in sr.get('items', [])]
    videos = []
    if ids:
        vr     = youtube.videos().list(part='snippet,statistics', id=','.join(ids)).execute()
        videos = vr.get('items', [])

    return {
        'channel_id':   channel_id,
        'channel_name': snippet['title'],
        'total_views':  int(stats.get('viewCount', 0)),
        'subscribers':  int(stats.get('subscriberCount', 0)),
        'total_videos': int(stats.get('videoCount', 0)),
        'videos':       videos,
    }

# ── Analyze ────────────────────────────────────────────────────────────────────
def analyze_metrics(data):
    videos = data['videos']
    total  = sum(int(v['statistics'].get('viewCount', 0)) for v in videos)
    avg    = total // len(videos) if videos else 0
    top    = sorted(videos, key=lambda v: int(v['statistics'].get('viewCount', 0)), reverse=True)[:5]
    return {**data, 'avg_views_per_video': avg, 'top_videos': top}

# ── Sheets ─────────────────────────────────────────────────────────────────────
def write_to_sheets(creds, data):
    from googleapiclient.discovery import build
    svc = build('sheets', 'v4', credentials=creds)
    sh  = svc.spreadsheets()
    sh.values().clear(spreadsheetId=SPREADSHEET_ID, range='Sheet1').execute()

    rows = [
        ['Channel Analysis Report', datetime.now().strftime('%Y-%m-%d %H:%M:%S')],
        [],
        ['Channel Name',    data['channel_name']],
        ['Channel ID',      data['channel_id']],
        ['Total Views',     data['total_views']],
        ['Subscribers',     data['subscribers']],
        ['Total Videos',    data['total_videos']],
        ['Avg Views/Video', data['avg_views_per_video']],
        [],
        ['#', 'Title', 'Published', 'Views', 'Likes', 'Comments'],
    ]
    for i, v in enumerate(data['videos'], 1):
        s = v['statistics']
        rows.append([
            i, v['snippet']['title'], v['snippet']['publishedAt'][:10],
            int(s.get('viewCount', 0)), int(s.get('likeCount', 0)), int(s.get('commentCount', 0)),
        ])
    sh.values().update(
        spreadsheetId=SPREADSHEET_ID, range='Sheet1!A1',
        valueInputOption='RAW', body={'values': rows}
    ).execute()

    # ── Formatting ─────────────────────────────────────────────────────────────
    n = len(data['videos'])

    def c(h):
        h = h.lstrip('#')
        return {'red': int(h[0:2],16)/255, 'green': int(h[2:4],16)/255, 'blue': int(h[4:6],16)/255}

    def cell(r1, r2, c1, c2, bg=None, fg=None, bold=None, size=None, align=None):
        fmt, flds = {}, []
        if bg is not None:
            fmt['backgroundColor'] = c(bg); flds.append('backgroundColor')
        tf, tfl = {}, []
        if fg   is not None: tf['foregroundColor'] = c(fg);  tfl.append('foregroundColor')
        if bold is not None: tf['bold']            = bold;   tfl.append('bold')
        if size is not None: tf['fontSize']        = size;   tfl.append('fontSize')
        if tf:
            fmt['textFormat'] = tf
            flds.append('textFormat(' + ','.join(tfl) + ')')
        if align is not None:
            fmt['horizontalAlignment'] = align; flds.append('horizontalAlignment')
        return {'repeatCell': {
            'range': {'sheetId': 0,
                      'startRowIndex': r1, 'endRowIndex': r2,
                      'startColumnIndex': c1, 'endColumnIndex': c2},
            'cell': {'userEnteredFormat': fmt},
            'fields': 'userEnteredFormat(' + ','.join(flds) + ')' if flds else 'userEnteredFormat',
        }}

    reqs = [
        cell(0, 1, 0, 6, bg='312e81', fg='e0e7ff', bold=True, size=12),
        cell(2, 8, 0, 1, bg='4338ca', fg='e0e7ff', bold=True),
        cell(2, 8, 1, 6, bg='1e1b4b', fg='c7d2fe'),
        cell(9, 10, 0, 6, bg='4f46e5', fg='ffffff', bold=True, align='CENTER'),
    ]
    for r in range(10, 10 + n):
        reqs.append(cell(r, r + 1, 0, 6,
                         bg='f5f3ff' if r % 2 == 0 else 'ede9fe', fg='1e1b4b'))
    if n:
        reqs.append(cell(10, 10 + n, 3, 6, align='RIGHT'))
    for i, w in enumerate([40, 300, 100, 90, 80, 90]):
        reqs.append({'updateDimensionProperties': {
            'range': {'sheetId': 0, 'dimension': 'COLUMNS',
                      'startIndex': i, 'endIndex': i + 1},
            'properties': {'pixelSize': w}, 'fields': 'pixelSize',
        }})
    reqs += [
        {'updateDimensionProperties': {
            'range': {'sheetId': 0, 'dimension': 'ROWS', 'startIndex': 0, 'endIndex': 1},
            'properties': {'pixelSize': 36}, 'fields': 'pixelSize',
        }},
        {'updateDimensionProperties': {
            'range': {'sheetId': 0, 'dimension': 'ROWS', 'startIndex': 9, 'endIndex': 10},
            'properties': {'pixelSize': 30}, 'fields': 'pixelSize',
        }},
        {'updateSheetProperties': {
            'properties': {'sheetId': 0, 'gridProperties': {'frozenRowCount': 10}},
            'fields': 'gridProperties.frozenRowCount',
        }},
    ]
    sh.batchUpdate(spreadsheetId=SPREADSHEET_ID, body={'requests': reqs}).execute()

# ── Slides ─────────────────────────────────────────────────────────────────────
def update_slides(creds, data):
    tools_dir = str(ROOT / 'tools')
    if tools_dir not in sys.path:
        sys.path.insert(0, tools_dir)
    from setup_slides import build_template

    build_template(creds, PRESENTATION_ID)

    from googleapiclient.discovery import build
    svc = build('slides', 'v1', credentials=creds)

    def replace(find, rep):
        return {'replaceAllText': {
            'containsText': {'text': find, 'matchCase': False},
            'replaceText': str(rep),
        }}

    svc.presentations().batchUpdate(presentationId=PRESENTATION_ID, body={'requests': [
        replace('{{CHANNEL_NAME}}', data['channel_name']),
        replace('{{TOTAL_VIEWS}}',  f"{data['total_views']:,}"),
        replace('{{SUBSCRIBERS}}',  f"{data['subscribers']:,}"),
        replace('{{TOTAL_VIDEOS}}', f"{data['total_videos']:,}"),
        replace('{{AVG_VIEWS}}',    f"{data['avg_views_per_video']:,}"),
        replace('{{REPORT_DATE}}',  datetime.now().strftime('%B %d, %Y')),
    ]}).execute()

# ── Email ──────────────────────────────────────────────────────────────────────
def send_email(creds, data):
    from googleapiclient.discovery import build
    svc = build('gmail', 'v1', credentials=creds)

    top_rows = ''.join(
        f"<tr>"
        f"<td style='padding:8px;border:1px solid #e0e0f0;'>{i+1}</td>"
        f"<td style='padding:8px;border:1px solid #e0e0f0;'>{v['snippet']['title'][:60]}</td>"
        f"<td style='padding:8px;border:1px solid #e0e0f0;'>{int(v['statistics'].get('viewCount',0)):,}</td>"
        f"</tr>"
        for i, v in enumerate(data.get('top_videos', []))
    )

    html = f"""<html><body style="font-family:sans-serif;color:#1a1a2e;max-width:600px;margin:0 auto;">
  <div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);padding:24px;border-radius:8px 8px 0 0;">
    <h1 style="color:white;margin:0;font-size:22px;">YT Analyst — Weekly Report</h1>
    <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;">{datetime.now().strftime('%B %d, %Y')}</p>
  </div>
  <div style="background:#f9f9ff;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0f0;">
    <h2 style="margin-top:0;">{data['channel_name']}</h2>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr><td style="padding:8px;border:1px solid #e0e0f0;"><b>Total Views</b></td>
          <td style="padding:8px;border:1px solid #e0e0f0;">{data['total_views']:,}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e0e0f0;"><b>Subscribers</b></td>
          <td style="padding:8px;border:1px solid #e0e0f0;">{data['subscribers']:,}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e0e0f0;"><b>Total Videos</b></td>
          <td style="padding:8px;border:1px solid #e0e0f0;">{data['total_videos']:,}</td></tr>
      <tr><td style="padding:8px;border:1px solid #e0e0f0;"><b>Avg Views/Video</b></td>
          <td style="padding:8px;border:1px solid #e0e0f0;">{data['avg_views_per_video']:,}</td></tr>
    </table>
    <h3>Top Videos This Week</h3>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr style="background:#6366f1;color:white;">
        <th style="padding:8px;text-align:left;">#</th>
        <th style="padding:8px;text-align:left;">Title</th>
        <th style="padding:8px;text-align:left;">Views</th>
      </tr>
      {top_rows}
    </table>
    <table style="width:100%;border-collapse:collapse;margin-bottom:24px;">
      <tr>
        <td style="padding:8px;text-align:center;">
          <a href="https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}"
             style="display:inline-block;background:#6366f1;color:white;padding:12px 28px;text-decoration:none;font-weight:bold;font-size:14px;border-radius:6px;">
            📊 View Spreadsheet
          </a>
        </td>
        <td style="padding:8px;text-align:center;">
          <a href="https://docs.google.com/presentation/d/{PRESENTATION_ID}"
             style="display:inline-block;background:#8b5cf6;color:white;padding:12px 28px;text-decoration:none;font-weight:bold;font-size:14px;border-radius:6px;">
            📑 View Slides
          </a>
        </td>
      </tr>
    </table>
    <p style="margin-top:8px;color:#888;font-size:12px;">Generated by YT Analyst — youtube-analysis-499500</p>
  </div>
</body></html>"""

    msg = MIMEMultipart('alternative')
    msg['Subject'] = f"YT Weekly Report: {data['channel_name']} — {datetime.now().strftime('%b %d, %Y')}"
    msg['From']    = SENDER_EMAIL
    msg['To']      = RECIPIENT_EMAIL
    msg.attach(MIMEText(html, 'html'))
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    svc.users().messages().send(userId='me', body={'raw': raw}).execute()

# ── Main ───────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='Run weekly YouTube analysis report')
    parser.add_argument('--channel', default=YOUTUBE_CHANNEL,
                        help='YouTube channel URL or ID (overrides YOUTUBE_CHANNEL in .env)')
    parser.add_argument('--weeks', type=int, default=1,
                        help='Weeks to look back (default: 1)')
    args = parser.parse_args()

    if not args.channel:
        print(f'\n  {R}Error:{X} No channel specified.')
        print(f'  Set YOUTUBE_CHANNEL in .env  or  pass --channel @yourhandle\n')
        sys.exit(1)

    end_date   = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(weeks=args.weeks)).strftime('%Y-%m-%d')

    print(f'\n  {B}YT Analyst — Weekly Report{X}')
    hr()
    print(f'  Channel  {args.channel}')
    print(f'  Period   {start_date} → {end_date}')
    hr()

    try:
        creds = get_credentials()
        ensure_spreadsheet(creds)
        ensure_presentation(creds)
        hr()

        data = fetch_youtube_data(args.channel, max_results=50,
                                  start_date=start_date, end_date=end_date)
        ok('fetch', f"'{data['channel_name']}' — {len(data['videos'])} videos")

        analyzed = analyze_metrics(data)
        ok('analyze', f"{len(analyzed['videos'])} videos · avg {analyzed['avg_views_per_video']:,} views")

        write_to_sheets(creds, analyzed)
        ok('sheets', f'https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}')

        update_slides(creds, analyzed)
        ok('slides', f'https://docs.google.com/presentation/d/{PRESENTATION_ID}')

        send_email(creds, analyzed)
        ok('email', f'Report sent → {RECIPIENT_EMAIL}')

        hr()
        print(f'  {G}Done.{X}\n')

    except KeyboardInterrupt:
        print(f'\n  {Y}Cancelled.{X}\n')
        sys.exit(0)
    except Exception as e:
        print(f'\n  {R}Error:{X} {e}\n')
        sys.exit(1)

if __name__ == '__main__':
    main()
