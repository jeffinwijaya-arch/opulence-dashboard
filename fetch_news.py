#!/usr/bin/env python3
"""Fetch luxury watch news from RSS feeds and save as JSON for the dashboard."""

import json, re, html, os, hashlib
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import urlopen, Request
from xml.etree import ElementTree as ET

FEEDS = [
    {"name": "Hodinkee", "url": "https://www.hodinkee.com/articles/rss.xml", "tag": "HODINKEE"},
    {"name": "Monochrome", "url": "https://monochrome-watches.com/feed/", "tag": "MONOCHROME"},
    {"name": "Fratello", "url": "https://www.fratellowatches.com/feed/", "tag": "FRATELLO"},
    {"name": "Revolution", "url": "https://revolutionwatch.com/feed/", "tag": "REVOLUTION"},
]

OUT = Path(__file__).parent / "public" / "data" / "news.json"

PRIORITY_KEYWORDS = [
    'rolex', 'patek', 'audemars', 'price', 'market', 'auction', 'record',
    'daytona', 'submariner', 'nautilus', 'royal oak', 'gmt-master',
    'day-date', 'datejust', 'sky-dweller', 'watches and wonders',
    'secondary market', 'pre-owned', 'investment', 'collector',
    'chronograph', 'perpetual', 'complication', 'Basel', 'Geneva',
]


def clean_html(raw):
    """Strip HTML tags and decode entities."""
    text = re.sub(r'<[^>]+>', '', raw or '')
    text = html.unescape(text)
    return text.strip()


def parse_date(date_str):
    """Parse RSS date string to ISO format."""
    if not date_str:
        return datetime.now(timezone.utc).isoformat()
    for fmt in [
        '%a, %d %b %Y %H:%M:%S %z',
        '%a, %d %b %Y %H:%M:%S %Z',
        '%Y-%m-%dT%H:%M:%S%z',
        '%Y-%m-%d %H:%M:%S',
    ]:
        try:
            dt = datetime.strptime(date_str.strip(), fmt)
            return dt.isoformat()
        except ValueError:
            continue
    return date_str


def relevance_score(title, desc):
    """Score article relevance for a watch dealer (0-100)."""
    text = (title + ' ' + desc).lower()
    score = 0
    for kw in PRIORITY_KEYWORDS:
        if kw in text:
            score += 10
    return min(score, 100)


def fetch_feed(feed):
    """Fetch and parse a single RSS feed."""
    articles = []
    try:
        req = Request(feed['url'], headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'application/rss+xml,application/xml,text/xml',
        })
        with urlopen(req, timeout=15) as resp:
            data = resp.read()
        root = ET.fromstring(data)

        ns = {
            'atom': 'http://www.w3.org/2005/Atom',
            'content': 'http://purl.org/rss/1.0/modules/content/',
            'media': 'http://search.yahoo.com/mrss/',
        }

        items = root.findall('.//item') or root.findall('.//atom:entry', ns)

        for item in items[:15]:
            title = item.findtext('title') or item.findtext('atom:title', '', ns) or ''
            link = item.findtext('link') or ''
            if not link:
                link_el = item.find('atom:link', ns)
                if link_el is not None:
                    link = link_el.get('href', '')

            desc = item.findtext('description') or item.findtext('atom:summary', '', ns) or ''
            desc = clean_html(desc)[:200]
            pub_date = item.findtext('pubDate') or item.findtext('atom:published', '', ns) or ''

            image = ''
            media_el = item.find('media:content', ns) or item.find('media:thumbnail', ns)
            if media_el is not None:
                image = media_el.get('url', '')
            if not image:
                content_el = item.findtext('content:encoded', '', ns)
                if content_el:
                    img_match = re.search(r'<img[^>]+src="([^"]+)"', content_el)
                    if img_match:
                        image = img_match.group(1)

            uid = hashlib.md5((title + link).encode()).hexdigest()[:12]

            articles.append({
                'id': uid,
                'title': clean_html(title),
                'link': link,
                'desc': desc,
                'date': parse_date(pub_date),
                'source': feed['tag'],
                'image': image,
                'relevance': relevance_score(title, desc),
            })

        print(f"  {feed['name']}: {len(articles)} articles")
    except Exception as e:
        print(f"  {feed['name']}: ERROR - {e}")
    return articles


def main():
    print("Fetching luxury watch news...")
    all_articles = []
    for feed in FEEDS:
        all_articles.extend(fetch_feed(feed))

    all_articles.sort(key=lambda a: (a['date'], a['relevance']), reverse=True)

    seen_titles = set()
    unique = []
    for a in all_articles:
        norm = re.sub(r'[^a-z0-9]', '', a['title'].lower())[:50]
        if norm not in seen_titles:
            seen_titles.add(norm)
            unique.append(a)

    unique = unique[:40]

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump({
            'articles': unique,
            'fetched_at': datetime.now(timezone.utc).isoformat(),
            'sources': [f['tag'] for f in FEEDS],
        }, f, indent=2)

    print(f"Saved {len(unique)} articles to {OUT}")


if __name__ == '__main__':
    main()
