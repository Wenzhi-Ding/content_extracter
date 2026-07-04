#!/usr/bin/env python3
"""
Extract all emails from the Outlook Web 'News' folder.

This script uses the Outlook REST API v2.0 with a bearer token taken from the
already-authenticated Outlook on the web session in Edge. It therefore retrieves
every message in the folder, not just the subset rendered by the virtual list.

Prerequisites:
- Kimi WebBridge running on http://127.0.0.1:10086/command
- User signed in to outlook.live.com in Edge

Usage:
    python scripts/extract_outlook_news.py
    python scripts/extract_outlook_news.py --output /tmp/news.md --format markdown
"""
import argparse
from datetime import datetime, timezone
import json
import os
import re
import sys
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Dict, List, Optional

import requests
from bs4 import BeautifulSoup

BASE_URL = "http://127.0.0.1:10086/command"
DEFAULT_SESSION = "outlook-news-extraction"
OUTLOOK_REST_BASE = "https://outlook.office.com/api/v2.0"


def wb_command(action: str, args: Optional[dict] = None, session: str = DEFAULT_SESSION) -> dict:
    """Send a command to the Kimi WebBridge HTTP endpoint."""
    resp = requests.post(
        BASE_URL,
        headers={"Content-Type": "application/json"},
        json={"action": action, "args": args or {}, "session": session},
        timeout=60,
    )
    resp.raise_for_status()
    return resp.json()


def evaluate_js(code: str, session: str = DEFAULT_SESSION) -> dict:
    """Execute JavaScript in the browser and return a JSON-parsed dict."""
    result = wb_command("evaluate", {"code": code}, session=session)
    if not result.get("ok"):
        raise RuntimeError(f"evaluate failed: {result}")
    value = result["data"]["value"]
    if isinstance(value, dict):
        return value
    if isinstance(value, str) and value.startswith(("{", "[")):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            pass
    raise RuntimeError(f"evaluate returned non-dict value: {type(value)}")


def extract_access_token(session: str = DEFAULT_SESSION) -> str:
    """Pull the OWA access token from localStorage and validate mail.read scope."""
    token_data = evaluate_js(
        """
        (function() {
            const clientId = '6bc89243-be1c-423a-99ec-b9a45b8b568b';
            const key = Object.keys(localStorage).find(k =>
                k.includes('accesstoken') && k.includes(clientId)
            );
            if (!key) return { error: 'No OWA access token found in localStorage' };
            const data = JSON.parse(localStorage.getItem(key));
            const rawTarget = data.target || '';
            const scopes = typeof rawTarget === 'string' ? rawTarget.split(/\s+/) : (Array.isArray(rawTarget) ? rawTarget : []);
            if (!scopes.some(s => s.toLowerCase().includes('mail.read'))) {
                return { error: 'Token missing mail.read scope', scopes: scopes };
            }
            return { token: data.secret, expires: data.expiresOn };
        })()
        """,
        session=session,
    )
    if isinstance(token_data, dict) and "error" in token_data:
        raise RuntimeError(token_data["error"])
    return token_data["token"]


def find_news_folder_id(token: str) -> str:
    """Locate the 'News' child folder under Inbox."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }

    # Resolve Inbox
    inbox_url = f"{OUTLOOK_REST_BASE}/me/MailFolders/Inbox"
    inbox_resp = requests.get(inbox_url, headers=headers, timeout=30)
    inbox_resp.raise_for_status()
    inbox_id = inbox_resp.json()["Id"]

    # Scan children
    children_url = f"{OUTLOOK_REST_BASE}/me/MailFolders('{inbox_id}')/ChildFolders"
    children_resp = requests.get(children_url, headers=headers, timeout=30)
    children_resp.raise_for_status()

    for folder in children_resp.json().get("value", []):
        if folder.get("DisplayName") == "News":
            return folder["Id"]

    raise RuntimeError("News folder not found under Inbox")


def fetch_messages(token: str, folder_id: str, prefer_text: bool = True) -> List[Dict]:
    """Fetch all messages from the News folder via Outlook REST API."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }
    if prefer_text:
        headers["Prefer"] = 'outlook.body-content-type="text"'

    select = "Id,Subject,Sender,ReceivedDateTime,Body,BodyPreview"
    url = f"{OUTLOOK_REST_BASE}/me/MailFolders('{folder_id}')/messages?$top=50&$select={select}"
    resp = requests.get(url, headers=headers, timeout=60)
    resp.raise_for_status()
    return resp.json().get("value", [])


def clean_body(html: str) -> str:
    """Convert HTML body to readable plain text."""
    if not html:
        return ""
    soup = BeautifulSoup(html, "lxml")
    # Remove scripts, styles, and invisible tracking pixels
    for tag in soup(["script", "style", "noscript", "iframe", "img"]):
        tag.decompose()
    # Replace anchors with their text + URL if useful
    for a in soup.find_all("a"):
        href = a.get("href", "")
        text = a.get_text(strip=True)
        if href and not href.startswith("mailto:") and len(text) < 80 and text != href:
            a.replace_with(f"{text} ({href})")
    text = soup.get_text(separator="\n")
    # Remove invisible characters
    text = re.sub(r"[\u00ad\u034f\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2060\ufeff]", "", text)
    # Collapse excessive blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Shorten safelinks
    text = re.sub(
        r"https://[\w.-]+\.safelinks\.protection\.outlook\.com/\?url=([^\s&]+)(&[^\s<]+)?",
        lambda m: urllib.parse.unquote(m.group(1)),
        text,
    )
    return text.strip()


def format_markdown(messages: List[Dict]) -> str:
    """Combine messages into a single Markdown document."""
    parts = ["# Outlook News Folder Digest", ""]
    parts.append(f"_Generated: {datetime.now(timezone.utc).isoformat()}_")
    parts.append(f"_Messages: {len(messages)}_")
    parts.append("")

    for idx, m in enumerate(messages, 1):
        subject = m.get("Subject") or "Untitled"
        sender = m.get("Sender", {}).get("EmailAddress", {}).get("Name", "Unknown")
        date = m.get("ReceivedDateTime", "Unknown")
        body_text = clean_body(m.get("Body", {}).get("Content", ""))
        preview = clean_body(m.get("BodyPreview", ""))

        parts.append(f"## {idx}. {subject}")
        parts.append(f"- **Sender:** {sender}")
        parts.append(f"- **Date:** {date}")
        parts.append("")
        if body_text and len(body_text) > len(preview) + 200:
            parts.append(body_text)
        else:
            parts.append(preview)
        parts.append("")
        parts.append("---")
        parts.append("")

    return "\n".join(parts)


def format_json(messages: List[Dict]) -> str:
    """Return a JSON representation of the messages."""
    simplified = []
    for m in messages:
        simplified.append(
            {
                "subject": m.get("Subject"),
                "sender": m.get("Sender", {}).get("EmailAddress", {}).get("Name"),
                "date": m.get("ReceivedDateTime"),
                "body": clean_body(m.get("Body", {}).get("Content", "")),
                "preview": clean_body(m.get("BodyPreview", "")),
            }
        )
    return json.dumps(simplified, ensure_ascii=False, indent=2)


def main():
    parser = argparse.ArgumentParser(description="Extract Outlook News folder emails via Outlook REST API")
    parser.add_argument("--output", "-o", default="/tmp/outlook_news_combined.md", help="Output file")
    parser.add_argument("--session", default=DEFAULT_SESSION, help="WebBridge session name")
    parser.add_argument(
        "--format",
        choices=["markdown", "json"],
        default="markdown",
        help="Output format",
    )
    parser.add_argument("--full-body", action="store_true", help="Request full message body (default uses preview)")
    args = parser.parse_args()

    print("Opening Outlook News folder...")
    wb_command("navigate", {"url": "https://outlook.live.com/mail/0/News"}, session=args.session)
    time.sleep(3)

    print("Extracting access token from browser localStorage...")
    token = extract_access_token(session=args.session)

    print("Locating News folder...")
    folder_id = find_news_folder_id(token)

    print("Fetching messages via Outlook REST API...")
    messages = fetch_messages(token, folder_id, prefer_text=args.full_body)
    print(f"Retrieved {len(messages)} messages")

    if args.format == "markdown":
        content = format_markdown(messages)
    else:
        content = format_json(messages)

    os.makedirs(os.path.dirname(os.path.abspath(args.output)) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(content)

    print(f"\nSaved {len(messages)} messages ({len(content)} chars) to {args.output}")


if __name__ == "__main__":
    main()
