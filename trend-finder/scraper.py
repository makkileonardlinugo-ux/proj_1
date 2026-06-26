"""
scraper.py — Phase 2 Trend Finder

Searches four live sources concurrently:
  - Google News RSS  (with base64 URL decode — no more redirects)
  - Reddit JSON API
  - Hacker News (Algolia)
  - Dev.to API

Returns top 8 ranked, deduplicated results with thumbnail URLs
pre-wrapped for the image proxy at localhost:3002.
"""

import os
import re
import json
import base64
import logging
from urllib.parse import urlparse, quote_plus
from concurrent.futures import ThreadPoolExecutor, as_completed

import feedparser
import requests

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "application/json, text/html, */*",
    "Accept-Language": "en-US,en;q=0.7",
}

IMAGE_PROXY = "http://localhost:3002/proxy/image?url="

_QUALITY_SOURCES = frozenset({
    "techcrunch", "theverge", "wired", "engadget", "arstechnica",
    "cnet", "gizmodo", "pcmag", "tomsguide", "digitaltrends",
    "reddit", "hackernews", "medium", "bloomberg", "reuters",
    "bbc", "nytimes", "wsj", "guardian", "forbes", "businessinsider",
    "dev.to", "devto",
})


# ─── Google News URL decoder ──────────────────────────────────────────────────

def _decode_google_news_url(url: str) -> str:
    """
    Decode the real article URL from a Google News RSS redirect link.
    Google News encodes the target URL as a base64url protobuf in the path.
    Returns the real URL, or the original if decoding fails.
    """
    try:
        m = re.search(r'/articles/([A-Za-z0-9_\-]+)', url)
        if not m:
            return url
        article_id = m.group(1)
        article_id += '=' * (-len(article_id) % 4)
        decoded = base64.urlsafe_b64decode(article_id)
        url_match = re.search(rb'https?://[^\x00-\x20\x7f-\xff]{10,}', decoded)
        if url_match:
            return url_match.group(0).decode('utf-8').rstrip('.')
    except Exception:
        pass
    return url


# ─── Google News RSS ─────────────────────────────────────────────────────────

def _feed_thumbnail(entry) -> str:
    """Extract thumbnail URL from a feedparser entry via multiple attribute paths."""
    if hasattr(entry, "media_thumbnail") and entry.media_thumbnail:
        url = entry.media_thumbnail[0].get("url", "")
        if url.startswith("http"):
            return url

    if hasattr(entry, "media_content") and entry.media_content:
        for m in entry.media_content:
            url = m.get("url", "")
            mtype = m.get("medium", "") + m.get("type", "")
            if url.startswith("http") and ("image" in mtype or url.rsplit(".", 1)[-1] in ("jpg", "jpeg", "png", "webp", "gif")):
                return url

    if hasattr(entry, "enclosures") and entry.enclosures:
        for enc in entry.enclosures:
            url = enc.get("url", "")
            if url.startswith("http") and "image" in enc.get("type", ""):
                return url

    return ""


def _search_google_news(query: str, n: int = 8) -> list:
    results = []
    try:
        feed_url = (
            f"https://news.google.com/rss/search?"
            f"q={quote_plus(query)}&hl=en-US&gl=US&ceid=US:en"
        )
        feed = feedparser.parse(feed_url)

        for entry in feed.entries[:n]:
            title = entry.get("title", "").strip()
            link  = entry.get("link", "")
            if not title or not link:
                continue

            source = ""
            if hasattr(entry, "source"):
                source = entry.source.get("title", "")

            # Decode real URL from Google's base64 redirect
            real_url = _decode_google_news_url(link)
            is_redirect = real_url == link  # still a redirect if decode failed

            raw_thumb = _feed_thumbnail(entry)
            thumbnail = (IMAGE_PROXY + quote_plus(raw_thumb)) if raw_thumb else ""

            published = entry.get("published", "")

            # Strip HTML from summary
            summary = entry.get("summary", "")
            summary = re.sub(r"<[^>]+>", "", summary).strip()[:200]

            results.append({
                "title":       title,
                "url":         real_url,
                "source":      source or "Google News",
                "thumbnail":   thumbnail,
                "platform":    "google_news",
                "is_redirect": is_redirect,
                "published":   published,
                "description": summary,
                "engagement":  0,
            })

    except Exception as exc:
        logger.warning("Google News scrape failed: %s", exc)

    return results


# ─── Reddit ──────────────────────────────────────────────────────────────────

def _search_reddit(query: str, n: int = 8) -> list:
    results = []
    try:
        resp = requests.get(
            "https://www.reddit.com/search.json",
            params={"q": query, "sort": "hot", "limit": n * 2, "t": "week", "type": "link"},
            headers={**_HEADERS, "User-Agent": "TrendFinder/2.0 (educational tool)"},
            timeout=13,
        )
        resp.raise_for_status()
        children = resp.json().get("data", {}).get("children", [])

        for post in children[:n]:
            p = post.get("data", {})
            title = (p.get("title") or "").strip()
            if not title:
                continue

            url        = p.get("url", "")
            permalink  = "https://www.reddit.com" + p.get("permalink", "")
            item_url   = url if (url and not url.startswith("https://www.reddit.com")) else permalink

            raw_thumb = p.get("thumbnail", "") or ""
            thumbnail = ""
            if raw_thumb.startswith("http"):
                thumbnail = IMAGE_PROXY + quote_plus(raw_thumb)

            import datetime
            ts = p.get("created_utc", 0)
            try:
                published = datetime.datetime.utcfromtimestamp(ts).strftime("%a, %d %b %Y")
            except Exception:
                published = ""

            selftext = (p.get("selftext") or "").strip()
            desc = selftext[:200] if selftext else f"Popular on r/{p.get('subreddit', 'reddit')}"

            results.append({
                "title":       title,
                "url":         item_url,
                "source":      f"r/{p.get('subreddit', 'reddit')}",
                "thumbnail":   thumbnail,
                "platform":    "reddit",
                "is_redirect": False,
                "published":   published,
                "description": desc,
                "engagement":  p.get("score", 0),
            })

    except Exception as exc:
        logger.warning("Reddit scrape failed: %s", exc)

    return results


# ─── Hacker News (Algolia) ───────────────────────────────────────────────────

def _search_hacker_news(query: str, n: int = 6) -> list:
    results = []
    try:
        resp = requests.get(
            "https://hn.algolia.com/api/v1/search",
            params={"query": query, "hitsPerPage": n * 2, "tags": "story"},
            headers=_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        hits = resp.json().get("hits", [])

        for hit in hits[:n]:
            title = (hit.get("title") or "").strip()
            url   = hit.get("url", "") or f"https://news.ycombinator.com/item?id={hit.get('objectID', '')}"
            if not title:
                continue

            published = hit.get("created_at", "")

            results.append({
                "title":       title,
                "url":         url,
                "source":      "Hacker News",
                "thumbnail":   "",
                "platform":    "hacker_news",
                "is_redirect": False,
                "published":   published[:10] if published else "",
                "description": f"{hit.get('points', 0)} points · {hit.get('num_comments', 0)} comments",
                "engagement":  hit.get("points", 0),
            })

    except Exception as exc:
        logger.warning("Hacker News scrape failed: %s", exc)

    return results


# ─── Dev.to ──────────────────────────────────────────────────────────────────

def _search_devto(query: str, n: int = 6) -> list:
    results = []
    try:
        # Use the first meaningful word as a tag (Dev.to tag search)
        words = [w for w in re.split(r'\W+', query.lower()) if len(w) > 2]
        tag = words[0] if words else ""

        params = {"per_page": n * 2, "state": "rising"}
        if tag:
            params["tag"] = tag

        resp = requests.get(
            "https://dev.to/api/articles",
            params=params,
            headers=_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        articles = resp.json()

        for article in articles[:n]:
            title = (article.get("title") or "").strip()
            url   = article.get("url") or article.get("canonical_url") or ""
            if not title or not url:
                continue

            published = (article.get("published_at") or "")[:10]
            cover     = article.get("cover_image") or article.get("social_image") or ""
            thumbnail = (IMAGE_PROXY + quote_plus(cover)) if cover else ""
            reactions = article.get("positive_reactions_count", 0)
            desc      = (article.get("description") or f"{reactions} reactions").strip()

            results.append({
                "title":       title,
                "url":         url,
                "source":      f"dev.to/@{article.get('user', {}).get('username', 'dev.to')}",
                "thumbnail":   thumbnail,
                "platform":    "devto",
                "is_redirect": False,
                "published":   published,
                "description": desc[:200],
                "engagement":  reactions,
            })

    except Exception as exc:
        logger.warning("Dev.to scrape failed: %s", exc)

    return results


# ─── Deduplication & scoring ─────────────────────────────────────────────────

def _domain(url: str) -> str:
    try:
        return urlparse(url).netloc.removeprefix("www.")
    except Exception:
        return url


def _dedup(results: list) -> list:
    seen_domains: dict = {}
    seen_titles:  set  = set()
    out = []

    for r in results:
        domain    = _domain(r["url"])
        title_key = re.sub(r"[^a-z0-9]", "", r["title"].lower())[:55]

        if title_key in seen_titles:
            continue

        if domain in seen_domains:
            prev = seen_domains[domain]
            if r.get("thumbnail") and not prev.get("thumbnail"):
                out = [x for x in out if x is not prev]
                seen_domains[domain] = r
                out.append(r)
                seen_titles.add(title_key)
            continue

        seen_domains[domain] = r
        seen_titles.add(title_key)
        out.append(r)

    return out


def _score(r: dict, words: list) -> int:
    score = 0
    tl = r["title"].lower()
    dl = r["description"].lower()

    for w in words:
        if len(w) < 3:
            continue
        score += 4 if w in tl else 0
        score += 1 if w in dl else 0

    if r.get("thumbnail"):
        score += 3
    if len(r.get("description", "")) > 60:
        score += 1

    src = (r.get("source") or "").lower()
    if any(s in src for s in _QUALITY_SOURCES):
        score += 2

    # Engagement bonus: Reddit upvotes, HN points, Dev.to reactions
    engagement = r.get("engagement", 0) or 0
    if engagement > 1000:
        score += 4
    elif engagement > 100:
        score += 2
    elif engagement > 10:
        score += 1

    return score


# ─── LLM helpers (Gemini primary, Groq fallback) ─────────────────────────────

def _llm_complete(prompt: str, max_tokens: int = 200, temperature: float = 0.1) -> str:
    """
    Run a completion: tries Gemini flash first, falls back to Groq on any error.
    Returns text or raises ValueError if neither key is available.
    """
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if gemini_key:
        try:
            import google.generativeai as genai
            genai.configure(api_key=gemini_key)
            model = genai.GenerativeModel("gemini-2.5-flash-lite")
            resp  = model.generate_content(
                prompt,
                generation_config=genai.GenerationConfig(
                    temperature=temperature, max_output_tokens=max_tokens,
                ),
            )
            return resp.text.strip()
        except Exception as exc:
            logger.warning("Gemini failed (%s), falling back to Groq.", exc)

    groq_key = os.environ.get("GROQ_API_KEY", "")
    if groq_key:
        from groq import Groq
        client = Groq(api_key=groq_key)
        resp = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=temperature,
        )
        return resp.choices[0].message.content.strip()

    raise ValueError("No LLM key available (set GEMINI_API_KEY or GROQ_API_KEY)")


def _expand_query(query: str) -> list:
    """
    Generate 2 alternative search queries via Gemini (or Groq fallback).
    Returns [original_query, alt1, alt2] or just [original_query] on failure.
    """
    try:
        raw = _llm_complete(
            f'Generate exactly 2 alternative search queries for the topic: "{query}"\n'
            "Make them diverse: different angles, synonyms, or related subtopics.\n"
            'Return ONLY a JSON array with 2 strings: ["alternative 1", "alternative 2"]',
            max_tokens=80,
            temperature=0.4,
        )
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        alternatives = json.loads(raw)
        if isinstance(alternatives, list):
            seen = {query.lower()}
            result = [query]
            for a in alternatives[:2]:
                a = str(a).strip()
                if a and a.lower() not in seen:
                    result.append(a)
                    seen.add(a.lower())
            return result
    except Exception as exc:
        logger.warning("Query expansion failed: %s", exc)
    return [query]


def _groq_rerank(results: list, query: str) -> list:
    """
    Semantically re-order results via Gemini (or Groq fallback).
    Falls back to the original order on any failure.
    """
    if len(results) <= 3:
        return results
    try:
        items = [
            {"idx": i, "title": r["title"], "src": r.get("source", ""), "desc": r.get("description", "")[:80]}
            for i, r in enumerate(results)
        ]
        raw = _llm_complete(
            f'Query: "{query}"\n\n'
            f'Rank these {len(items)} articles from most to least relevant to the query.\n'
            "Consider: topical relevance, source quality, recency signals.\n"
            "Return ONLY a JSON array of 0-based indices, e.g. [2,0,5,1,3,4]:\n\n"
            + json.dumps(items, separators=(",", ":")),
            max_tokens=150,
            temperature=0.1,
        )
        raw = re.sub(r"^```(?:json)?\s*", "", raw, flags=re.MULTILINE)
        raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
        order = json.loads(raw)
        if isinstance(order, list) and all(isinstance(x, int) for x in order):
            reranked, seen = [], set()
            for idx in order:
                if 0 <= idx < len(results) and idx not in seen:
                    reranked.append(results[idx])
                    seen.add(idx)
            for i, r in enumerate(results):
                if i not in seen:
                    reranked.append(r)
            return reranked
    except Exception as exc:
        logger.warning("Groq re-ranking failed: %s", exc)
    return results


# ─── Public entry point ───────────────────────────────────────────────────────

def search_trends(query: str, top_n: int = 8) -> list:
    """
    Pipeline:
      1. Fire original search + Gemini query expansion concurrently
      2. When expansion returns, fire alternative query searches
      3. Merge all results, deduplicate
      4. Keyword pre-score → take top 20 candidates
      5. Gemini semantic re-rank → return top_n

    Each result dict: title, url, source, thumbnail, platform,
                      is_redirect, published, description, engagement.
    """
    words = query.lower().split()

    # Phase 1: original search + Gemini expansion in parallel
    with ThreadPoolExecutor(max_workers=5) as ex:
        orig_gn  = ex.submit(_search_google_news, query, 8)
        orig_rd  = ex.submit(_search_reddit,      query, 8)
        orig_hn  = ex.submit(_search_hacker_news, query, 6)
        orig_dt  = ex.submit(_search_devto,       query, 6)
        expand_f = ex.submit(_expand_query,        query)

        raw_original = []
        queries_extra = [query]
        for fut in as_completed([orig_gn, orig_rd, orig_hn, orig_dt, expand_f], timeout=22):
            try:
                result = fut.result(timeout=2)
                if fut is expand_f:
                    queries_extra = result  # [original, alt1, alt2]
                else:
                    raw_original.extend(result or [])
            except Exception:
                pass

    # Phase 2: search alternative queries (skip the original already done)
    raw_extra = []
    alt_queries = [q for q in queries_extra if q != query]
    if alt_queries:
        tasks = []
        with ThreadPoolExecutor(max_workers=4 * len(alt_queries)) as ex:
            for q in alt_queries:
                tasks.append(ex.submit(_search_google_news, q, 6))
                tasks.append(ex.submit(_search_reddit,      q, 6))
                tasks.append(ex.submit(_search_hacker_news, q, 5))
                tasks.append(ex.submit(_search_devto,       q, 5))
            for fut in as_completed(tasks, timeout=20):
                try:
                    raw_extra.extend(fut.result(timeout=2) or [])
                except Exception:
                    pass

    all_results = raw_original + raw_extra
    if not all_results:
        return []

    # Dedup, then keyword-score to pick top 20 candidates for Gemini
    unique     = _dedup(all_results)
    candidates = sorted(unique, key=lambda r: _score(r, words), reverse=True)[:20]

    # Groq semantic re-rank
    reranked = _groq_rerank(candidates, query)

    final = []
    for i, r in enumerate(reranked[:top_n], start=1):
        r["rank"] = i
        final.append(r)

    return final
