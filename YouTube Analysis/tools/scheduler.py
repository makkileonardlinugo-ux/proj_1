#!/usr/bin/env python3
"""
YT Analyst — Schedule Manager
Registers automated reports with Windows Task Scheduler.
Run: python tools/scheduler.py
"""
import os, sys, json, subprocess
from pathlib import Path
from datetime import datetime

ROOT        = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / 'schedule_config.json'
SCRIPT_PATH = ROOT / 'tools' / 'run_weekly_report.py'
PYTHON_EXE  = sys.executable
TASK_NAME   = 'YTAnalyst_AutoReport'

# ── ANSI ───────────────────────────────────────────────────────────────────────
R='\033[91m'; G='\033[92m'; Y='\033[93m'; B='\033[94m'
W='\033[97m'; D='\033[2m';  X='\033[0m';  BOLD='\033[1m'

DAYS      = ['MON','TUE','WED','THU','FRI','SAT','SUN']
DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']

# ── Helpers ────────────────────────────────────────────────────────────────────
def clear(): os.system('cls' if os.name == 'nt' else 'clear')

def header():
    print(f'\n{W}  ╔{"═"*50}╗{X}')
    print(f'{W}  ║{"  YT ANALYST  ·  SCHEDULE MANAGER":^50}║{X}')
    print(f'{W}  ╚{"═"*50}╝{X}\n')

def rule(): print(f'  {D}{"─"*52}{X}')

def ask(prompt, default=''):
    shown = f' [{default}]' if default else ''
    val = input(f'  {W}>{X} {prompt}{D}{shown}{X}: ').strip()
    return val or default

def confirm(prompt):
    return ask(prompt + ' [y/N]', '').lower() == 'y'

# ── Config ─────────────────────────────────────────────────────────────────────
def load_config():
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return {}

def save_config(cfg):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(cfg, f, indent=2)

# ── Task Scheduler ─────────────────────────────────────────────────────────────
def task_exists():
    r = subprocess.run(['schtasks','/query','/tn',TASK_NAME],
                       capture_output=True, text=True)
    return r.returncode == 0

def get_next_run():
    r = subprocess.run(['schtasks','/query','/tn',TASK_NAME,'/fo','LIST'],
                       capture_output=True, text=True)
    if r.returncode != 0:
        return None, None
    next_run = last_run = None
    for line in r.stdout.splitlines():
        if 'Next Run Time' in line:
            next_run = line.split(':',1)[1].strip()
        if 'Last Run Time' in line:
            last_run = line.split(':',1)[1].strip()
    return next_run, last_run

def register_task(channel, frequency, day, time_str, weeks=1):
    cmd = f'"{PYTHON_EXE}" "{SCRIPT_PATH}" --channel {channel} --weeks {weeks}'

    args = ['schtasks','/create','/f',
            '/tn',  TASK_NAME,
            '/tr',  cmd,
            '/st',  time_str,
            '/rl',  'HIGHEST']

    if frequency == 'daily':
        args += ['/sc','DAILY']
    elif frequency == 'weekly':
        args += ['/sc','WEEKLY','/d',day]
    elif frequency == 'monthly':
        args += ['/sc','MONTHLY','/d','1']

    r = subprocess.run(args, capture_output=True, text=True)
    return r.returncode == 0, r.stderr.strip()

def remove_task():
    r = subprocess.run(['schtasks','/delete','/tn',TASK_NAME,'/f'],
                       capture_output=True, text=True)
    return r.returncode == 0

def trigger_task_now():
    r = subprocess.run(['schtasks','/run','/tn',TASK_NAME],
                       capture_output=True, text=True)
    return r.returncode == 0

# ── Status panel ───────────────────────────────────────────────────────────────
def show_status():
    cfg    = load_config()
    active = task_exists()

    rule()
    status_str = f'{G}● ACTIVE{X}' if active else f'{D}○ NOT SCHEDULED{X}'
    print(f'  {"STATUS":<22}{status_str}')

    if cfg:
        ch = cfg.get('channel','—')
        fr = cfg.get('frequency','—').upper()
        tm = cfg.get('time','—')
        rc = cfg.get('recipient','—')
        print(f'  {"CHANNEL":<22}{W}{ch}{X}')
        print(f'  {"FREQUENCY":<22}{W}{fr}', end='')
        if cfg.get('frequency') == 'weekly':
            idx = DAYS.index(cfg.get('day','MON')) if cfg.get('day','MON') in DAYS else 0
            print(f'  ({DAY_NAMES[idx]})', end='')
        print(X)
        print(f'  {"TIME":<22}{W}{tm}{X}')
        print(f'  {"RECIPIENT":<22}{D}{rc}{X}')

    if active:
        nxt, lst = get_next_run()
        if nxt: print(f'  {"NEXT RUN":<22}{Y}{nxt}{X}')
        if lst: print(f'  {"LAST RUN":<22}{D}{lst}{X}')

    rule()
    print()

# ── Setup flow ─────────────────────────────────────────────────────────────────
def setup_schedule():
    from dotenv import load_dotenv
    load_dotenv(ROOT / '.env')

    default_ch  = os.getenv('YOUTUBE_CHANNEL','')
    recipient   = os.getenv('RECIPIENT_EMAIL','')

    print(f'  {Y}── CONFIGURE SCHEDULE ──────────────────────────{X}\n')

    # Channel
    channel = ask('YouTube channel (URL or @handle)', default_ch)
    if not channel:
        print(f'\n  {R}Error: channel is required.{X}\n'); return

    # Frequency
    print(f'\n  Frequency:')
    print(f'  {W}[1]{X} Daily')
    print(f'  {W}[2]{X} Weekly  {D}← recommended{X}')
    print(f'  {W}[3]{X} Monthly {D}(1st of each month){X}')
    fc = ask('Choice', '2')
    frequency = {'1':'daily','2':'weekly','3':'monthly'}.get(fc,'weekly')

    day = 'MON'
    if frequency == 'weekly':
        print(f'\n  Day of week:')
        for i,name in enumerate(DAY_NAMES,1):
            print(f'  {W}[{i}]{X} {name}')
        dc = ask('Choice','1')
        try:   day = DAYS[int(dc)-1]
        except: day = 'MON'

    # Look-back window
    weeks = 1
    if frequency == 'weekly':
        wk = ask('Weeks of data to fetch per run', '1')
        try:   weeks = max(1, int(wk))
        except: weeks = 1

    # Time
    print(f'\n  Time to run (24h HH:MM):')
    time_raw = ask('Time','08:00')
    try:
        h, m   = time_raw.split(':')
        time_str = f'{int(h):02d}:{int(m):02d}'
    except:
        time_str = '08:00'

    # Summary
    print(f'\n  {D}{"─"*48}{X}')
    print(f'  Channel    {W}{channel}{X}')
    print(f'  Frequency  {W}{frequency.upper()}{(" — " + DAY_NAMES[DAYS.index(day)]) if frequency=="weekly" else ""}{X}')
    print(f'  Time       {W}{time_str}{X}')
    print(f'  Report to  {W}{recipient}{X}')
    print(f'  {D}{"─"*48}{X}\n')

    if not confirm('Register this schedule?'):
        print(f'  {D}Cancelled.{X}\n'); return

    ok, err = register_task(channel, frequency, day, time_str, weeks)
    if ok:
        save_config({
            'channel':   channel,
            'frequency': frequency,
            'day':       day,
            'time':      time_str,
            'weeks':     weeks,
            'recipient': recipient,
            'updated':   datetime.now().isoformat(),
        })
        nxt, _ = get_next_run()
        print(f'\n  {G}✓  Schedule registered!{X}')
        if nxt: print(f'  {G}✓  First run: {nxt}{X}')
        print()
    else:
        print(f'\n  {R}✗  Failed to register task.{X}')
        if err: print(f'  {D}{err}{X}')
        print()

# ── Run now ────────────────────────────────────────────────────────────────────
def run_now():
    cfg = load_config()
    channel = cfg.get('channel','')

    if not channel:
        channel = ask('No channel saved. Enter channel to run now','')
    if not channel:
        print(f'  {R}No channel specified.{X}\n'); return

    print(f'\n  {D}Launching pipeline for {channel}...{X}\n')
    print(f'  {"─"*52}')
    subprocess.run(
        [PYTHON_EXE, str(SCRIPT_PATH), '--channel', channel,
         '--weeks', str(cfg.get('weeks',1))],
        cwd=str(ROOT)
    )
    print(f'  {"─"*52}\n')

# ── Main loop ──────────────────────────────────────────────────────────────────
def main():
    while True:
        clear()
        header()
        show_status()

        print(f'  {W}[1]{X}  Set / Update Schedule')
        print(f'  {W}[2]{X}  Run Report Now')
        print(f'  {W}[3]{X}  Disable / Remove Schedule')
        print(f'  {W}[4]{X}  Exit')
        print()

        choice = ask('Select','').strip()

        if choice == '1':
            clear(); header()
            setup_schedule()
            input(f'  Press Enter to continue...')

        elif choice == '2':
            clear(); header()
            run_now()
            input(f'  Press Enter to continue...')

        elif choice == '3':
            clear(); header()
            if task_exists():
                if confirm('Remove the scheduled task?'):
                    if remove_task():
                        print(f'  {G}✓  Schedule removed.{X}\n')
                    else:
                        print(f'  {R}✗  Could not remove task.{X}\n')
            else:
                print(f'  {D}No active schedule found.{X}\n')
            input(f'  Press Enter to continue...')

        elif choice == '4':
            clear()
            print(f'\n  {D}Goodbye.{X}\n')
            sys.exit(0)

if __name__ == '__main__':
    main()
