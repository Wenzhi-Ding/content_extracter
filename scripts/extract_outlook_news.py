#!/usr/bin/env python3
"""
Extract all emails from the Outlook Web 'News' folder via Kimi WebBridge.

Prerequisites:
- Kimi WebBridge running on http://127.0.0.1:10086/command
- User signed in to outlook.live.com in Edge
- content-extractor API bundle built at ../dist/content-extractor-api.js

Usage:
    python scripts/extract_outlook_news.py
    python scripts/extract_outlook_news.py --output /tmp/news.md
"""
import argparse
from typing import Dict, List, Optional
import json
import os
import sys
import time

import requests

BASE_URL = 'http://127.0.0.1:10086/command'
DEFAULT_SESSION = 'outlook-news-extraction'
DEFAULT_API_SCRIPT = os.path.join(os.path.dirname(__file__), '..', 'dist', 'content-extractor-api.js')


def wb_command(action: str, args: Optional[dict] = None, session: str = DEFAULT_SESSION) -> dict:
    """Send a command to the Kimi WebBridge HTTP endpoint."""
    resp = requests.post(
        BASE_URL,
        headers={'Content-Type': 'application/json'},
        json={'action': action, 'args': args or {}, 'session': session},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def evaluate_js(code: str, session: str = DEFAULT_SESSION) -> object:
    """Execute JavaScript in the browser and return the wrapped value."""
    result = wb_command('evaluate', {'code': code}, session=session)
    if not result.get('ok'):
        raise RuntimeError(f"evaluate failed: {result}")
    value = result['data']['value']
    if isinstance(value, str) and value.startswith(('{', '[')):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            pass
    return value


def load_all_emails(max_iterations: int = 50, stable_threshold: int = 3) -> List[dict]:
    """Scroll the Outlook message list until no new items appear."""
    all_convids: dict[str, str] = {}
    stable_count = 0

    for i in range(max_iterations):
        items = evaluate_js('''
            (function() {
                return JSON.stringify(Array.from(document.querySelectorAll('[data-convid]')).map(function(el) {
                    return {
                        convid: el.getAttribute('data-convid'),
                        text: el.innerText.slice(0, 120)
                    };
                }));
            })()
        ''')

        new_count = 0
        for item in items:
            convid = item['convid']
            if convid not in all_convids:
                all_convids[convid] = item['text']
                new_count += 1

        print(f'  Scroll iter {i + 1}: visible={len(items)}, new={new_count}, total={len(all_convids)}')

        if new_count == 0:
            stable_count += 1
            if stable_count >= stable_threshold:
                print('  List fully loaded.')
                break
        else:
            stable_count = 0

        # Scroll the message list container down by ~80% of its viewport.
        scroll_info = evaluate_js('''
            (function() {
                var item = document.querySelector('[data-convid]');
                var el = item;
                while (el && el !== document.body) {
                    var style = window.getComputedStyle(el);
                    if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                        var step = Math.floor(el.clientHeight * 0.8);
                        var newTop = Math.min(el.scrollTop + step, el.scrollHeight - el.clientHeight);
                        el.scrollTop = newTop;
                        return JSON.stringify({ scrollTop: newTop, maxScroll: el.scrollHeight - el.clientHeight });
                    }
                    el = el.parentElement;
                }
                return JSON.stringify({ error: 'no scroll container found' });
            })()
        ''')

        if isinstance(scroll_info, dict) and 'error' in scroll_info:
            print(f"  Error: {scroll_info['error']}")
            break

        time.sleep(0.8)

    return [{'convid': k, 'preview': v} for k, v in all_convids.items()]


def extract_email(api_script: str, convid: str) -> dict:
    """Click a message by convid and extract its content via the injected API."""
    click_result = evaluate_js(f'''
        (function() {{
            var el = document.querySelector('[data-convid="{convid}"]');
            if (el) {{ el.click(); return 'clicked'; }}
            return 'not found';
        }})()
    ''')
    if click_result != 'clicked':
        raise RuntimeError(f'Could not click email {convid}: {click_result}')

    time.sleep(2.0)

    raw = evaluate_js('''
        window.__contentExtractor.extract().then(function(r) {
            return JSON.stringify({
                title: r.title,
                sender: r.sender,
                emailSubject: r.emailSubject,
                emailDate: r.emailDate,
                markdown: r.markdown
            });
        })
    ''')
    return raw if isinstance(raw, dict) else json.loads(raw)


def combine_emails(extracted: List[dict]) -> str:
    """Combine extracted emails into a single Markdown document."""
    parts = []
    for data in extracted:
        subject = data.get('emailSubject') or data.get('title') or 'Untitled'
        sender = data.get('sender') or 'Unknown'
        date = data.get('emailDate') or 'Unknown'
        markdown = data.get('markdown', '')

        parts.append(f'## {subject}')
        parts.append(f'- **Sender:** {sender}')
        parts.append(f'- **Date:** {date}')
        parts.append('')
        parts.append(markdown)
        parts.append('')
        parts.append('---')
        parts.append('')
    return '\n'.join(parts)


def main():
    parser = argparse.ArgumentParser(description='Extract Outlook News folder emails via Kimi WebBridge')
    parser.add_argument('--output', '-o', default='/tmp/outlook_news_combined.md', help='Output markdown file')
    parser.add_argument('--api-script', default=DEFAULT_API_SCRIPT, help='Path to content-extractor-api.js')
    parser.add_argument('--session', default=DEFAULT_SESSION, help='WebBridge session name')
    args = parser.parse_args()

    if not os.path.exists(args.api_script):
        print(f'API script not found: {args.api_script}', file=sys.stderr)
        print('Build it first with: npm run build', file=sys.stderr)
        sys.exit(1)

    with open(args.api_script, 'r', encoding='utf-8') as f:
        api_script = f.read()

    print('Opening Outlook News folder...')
    wb_command('launch', {'url': 'https://outlook.live.com/mail/0/News'}, session=args.session)
    time.sleep(3)

    print('Loading all emails by scrolling the message list...')
    emails = load_all_emails()
    print(f'\nTotal emails to extract: {len(emails)}')

    print('Injecting content extractor API...')
    evaluate_js(f'''
        window.__apiInjectedResult = "starting";
        try {{ {api_script} window.__apiInjectedResult = "success"; }}
        catch (e) {{ window.__apiInjectedResult = "error: " + e.message; }}
    ''', session=args.session)
    time.sleep(0.5)

    extracted = []
    for idx, email in enumerate(emails, 1):
        preview = email['preview']
        print(f'\nExtracting {idx}/{len(emails)}: {preview[:60]}...')
        try:
            data = extract_email(api_script, email['convid'])
            extracted.append(data)
            print(f'  -> length: {len(data.get("markdown", ""))}')
        except Exception as e:
            print(f'  -> error: {e}')

    combined = combine_emails(extracted)
    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or '.', exist_ok=True)
    with open(args.output, 'w', encoding='utf-8') as f:
        f.write(combined)

    print(f'\nSaved {len(extracted)} emails ({len(combined)} chars) to {args.output}')


if __name__ == '__main__':
    main()
