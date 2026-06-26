"""
extraction.py — Article cleaner + Gemini Flash integration

Flow:
  1. Fetch article HTML with requests
  2. BeautifulSoup removes clutter (nav, ads, sidebar, etc.)
  3. Extract clean readable text from <article> / <main> / body
  4. Send clean text to Gemini 1.5 Flash for structured extraction
  5. Return { success, engine, title, source_url, items:[{rank, idea}] }

Falls back to regex-based extraction if Gemini is unavailable.
Detects Google News redirect pages and returns a specific error.
"""

import os
import re
import json
import base64
import logging

import requests
from bs4 import BeautifulSoup, Comment

logger = logging.getLogger(__name__)

GROQ_API_KEY   = os.environ.get("GROQ_API_KEY", "")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")  # kept for legacy reference

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/123.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.7",
}

_REMOVE_TAGS = [
    "nav", "header", "footer", "aside", "script", "style",
    "iframe", "form", "noscript", "picture",
]

_REMOVE_CLASS_PATTERNS = re.compile(
    r"\b(nav|header|footer|sidebar|ad|ads|advertisement|banner|promo|"
    r"related|recommended|newsletter|subscribe|cookie|popup|modal|overlay|"
    r"comment|share|social|breadcrumb|pagination|widget|sticky|flyout|"
    r"menu|toolbar|logo|search-bar)\b",
    re.IGNORECASE,
)

_GEMINI_PROMPT = (
    "You are an expert content analyst. Analyze the following article text and extract "
    "the main ranked list of products, tools, ideas, recommendations, or items discussed.\n\n"
    "Return ONLY a single valid JSON object — no markdown, no explanation, no code blocks:\n"
    '{"title":"<article title or topic>","items":[{"rank":1,"idea":"<first item>"},{"rank":2,"idea":"<second item>"}]}\n\n'
    "Rules:\n"
    "- If no explicit numbered list exists, extract the key points as a numbered list (max 15)\n"
    "- Each idea must be concise (under 120 chars) but descriptive\n"
    "- Preserve original ranking if the article has one\n\n"
    "Article text:\n"
)

_GEMINI_HTML_PROMPT = (
    "You are an expert content analyst. The following is raw HTML from a webpage. "
    "Ignore all navigation, ads, headers, footers, scripts, and boilerplate. "
    "Find the main article or post content and extract its key points, recommendations, or ranked items.\n\n"
    "Return ONLY a single valid JSON object — no markdown, no explanation, no code blocks:\n"
    '{"title":"<article title>","items":[{"rank":1,"idea":"<first point>"},{"rank":2,"idea":"<second point>"}]}\n\n'
    "Rules:\n"
    "- Extract only from the main article body, not site chrome\n"
    "- Each idea must be concise (under 120 chars) but descriptive\n"
    "- Maximum 15 items\n"
    "- If the page is a paywall or login wall with no real content, return empty items []\n\n"
    "Raw HTML:\n"
)


# ─── Google News URL handling ─────────────────────────────────────────────────

def _decode_google_news_url(url: str) -> str:
    """Decode real article URL from a Google News RSS base64 redirect."""
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


def _is_google_redirect(url: str, final_url: str) -> bool:
    return "news.google.com" in final_url or "news.google.com" in url


# ─── HTML cleaning ────────────────────────────────────────────────────────────

def _clean_html(html: str) -> BeautifulSoup:
    soup = BeautifulSoup(html, "html.parser")

    # Remove HTML comments
    for comment in soup.find_all(string=lambda t: isinstance(t, Comment)):
        comment.extract()

    # Remove unwanted tags
    for tag in _REMOVE_TAGS:
        for el in soup.find_all(tag):
            el.decompose()

    # Remove elements by class name
    for el in soup.find_all(class_=True):
        if not el.attrs:
            continue
        classes = " ".join(el.get("class", []) or [])
        if _REMOVE_CLASS_PATTERNS.search(classes):
            el.decompose()

    # Remove elements by id
    for el in soup.find_all(id=True):
        if not el.attrs:
            continue
        if _REMOVE_CLASS_PATTERNS.search(el.get("id", "") or ""):
            el.decompose()

    return soup


def _extract_text(soup: BeautifulSoup) -> str:
    # Priority: <article> > <main> > [role=main] > first large <div> > body
    content = (
        soup.find("article")
        or soup.find("main")
        or soup.find(attrs={"role": "main"})
        or soup.find(id=re.compile(r"content|article|post|story|body", re.I))
        or soup.find(class_=re.compile(r"content|article|post|story|body", re.I))
        or soup.find("body")
    )

    if not content:
        return ""

    text = content.get_text(separator="\n", strip=True)
    lines = [l.strip() for l in text.splitlines() if l.strip() and len(l.strip()) > 25]
    return "\n".join(lines)[:9000]


# ─── Groq LLM calls ──────────────────────────────────────────────────────────

def _parse_llm_json(raw: str) -> dict:
    """Strip code fences and extract the first JSON object from LLM output."""
    raw = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
    raw = re.sub(r"\s*```$", "", raw, flags=re.MULTILINE)
    m = re.search(r"\{.*\}", raw, re.DOTALL)
    if m:
        raw = m.group(0)
    return json.loads(raw)


def _normalize_items(data: dict, source_url: str) -> dict:
    cleaned = []
    for i, item in enumerate(data.get("items", []), start=1):
        rank = item.get("rank") or i
        idea = str(item.get("idea") or item.get("text") or item.get("name") or "").strip()
        if idea and len(idea) > 3:
            cleaned.append({"rank": rank, "idea": idea})
    return {"title": data.get("title", ""), "source_url": source_url, "items": cleaned}


def _llm_complete(prompt: str, max_tokens: int = 2048) -> str:
    """
    Run a JSON-structured completion: Gemini primary, Groq fallback.
    Always returns text; raises ValueError if no key is available.
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
                    temperature=0.1, max_output_tokens=max_tokens,
                ),
            )
            return resp.text.strip()
        except Exception as exc:
            logger.warning("Gemini extraction failed (%s), falling back to Groq.", exc)

    groq_key = os.environ.get("GROQ_API_KEY", "")
    if groq_key:
        from groq import Groq
        client = Groq(api_key=groq_key)
        resp = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=max_tokens,
            temperature=0.1,
            response_format={"type": "json_object"},
        )
        return resp.choices[0].message.content.strip()

    raise ValueError("No LLM key available (set GEMINI_API_KEY or GROQ_API_KEY)")


def _call_gemini(text: str, source_url: str) -> dict:
    raw  = _llm_complete(_GEMINI_PROMPT + text)
    data = _parse_llm_json(raw)
    return _normalize_items(data, source_url)


def _call_gemini_raw_html(raw_html: str, source_url: str) -> dict:
    html_stripped  = re.sub(r"<(script|style)[^>]*>.*?</(script|style)>", "", raw_html,
                            flags=re.DOTALL | re.IGNORECASE)
    html_truncated = html_stripped[:12000]
    raw  = _llm_complete(_GEMINI_HTML_PROMPT + html_truncated)
    data = _parse_llm_json(raw)
    return _normalize_items(data, source_url)


# ─── HTML fallback extractor ──────────────────────────────────────────────────

def _html_fallback(text: str, source_url: str) -> dict:
    """Regex-based extraction: finds numbered lists, bullets, or headings."""
    items = []
    rank = 1

    patterns = [
        re.compile(r"^\d{1,2}[\.\)]\s+(.{10,150})$"),   # 1. item  or  1) item
        re.compile(r"^[-•*]\s+(.{10,150})$"),             # - item   or  • item
        re.compile(r"^#+\s+(.{10,150})$"),                # ## Heading
        re.compile(r"^(.{20,150}):?\s*$"),                # Standalone line (fallback)
    ]

    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        for i, pat in enumerate(patterns):
            m = pat.match(line)
            if m:
                idea = m.group(1).strip().rstrip(":")
                # Skip lines that are clearly sentences (no list structure)
                if i == 3 and not any(c.isdigit() for c in idea[:5]) and len(idea.split()) > 12:
                    continue
                items.append({"rank": rank, "idea": idea})
                rank += 1
                break
        if rank > 20:
            break

    return {
        "title":      "",
        "source_url": source_url,
        "items":      items,
    }


# ─── Snippet extraction (no URL fetch needed) ────────────────────────────────

def extract_from_snippet(title: str, description: str) -> dict:
    """
    Extract key insights from just a title + RSS summary using Groq.
    Used for Google News redirect articles where the URL can't be visited.
    """
    if not os.environ.get("GEMINI_API_KEY") and not os.environ.get("GROQ_API_KEY"):
        return {"success": False, "error": "no_llm", "message": "No LLM key configured (GEMINI_API_KEY or GROQ_API_KEY)."}

    text = f"Title: {title.strip()}\n\nSummary: {description.strip()}"
    if len(text.strip()) < 20:
        return {"success": False, "error": "no_content", "message": "Snippet too short to analyze."}

    try:
        prompt = (
            "Analyze this article title and summary snippet. Extract and infer the key points, "
            "findings, or items being discussed. Return a JSON object:\n"
            '{"title":"<article title>","items":[{"rank":1,"idea":"<key point>"}]}\n\n'
            "Rules: extract up to 8 key points, each under 120 chars, specific and informative.\n\n"
            + text
        )
        raw  = _llm_complete(prompt, max_tokens=800)
        data = _parse_llm_json(raw)
        result = _normalize_items(data, "")

        if not result["items"]:
            return {"success": False, "error": "no_items", "message": "Could not extract key points from snippet."}

        return {
            "success":    True,
            "engine":     "groq-snippet",
            "title":      result.get("title") or title,
            "source_url": "",
            "items":      result["items"],
        }

    except Exception as exc:
        logger.error("Snippet extraction failed: %s", exc)
        return {"success": False, "error": "error", "message": "Snippet extraction failed."}


# ─── Public entry point ───────────────────────────────────────────────────────

def extract_article(url: str) -> dict:
    """
    Fetch, clean, and extract structured ideas from an article URL.

    Returns:
        success=True:  { success, engine, title, source_url, items:[{rank, idea}] }
        success=False: { success, error, message }
    """
    try:
        # Decode Google News redirect URLs before fetching
        if "news.google.com" in url:
            decoded = _decode_google_news_url(url)
            if decoded != url:
                url = decoded

        resp = requests.get(url, headers=_HEADERS, timeout=14, allow_redirects=True)
        resp.raise_for_status()

        final_url = resp.url

        # Guard: if decode failed and we still landed on Google News
        if _is_google_redirect(url, final_url):
            return {
                "success": False,
                "error":   "redirect",
                "message": "This is a Google News redirect URL. Open the article in your browser, copy the final URL, and paste it here.",
            }

        soup = _clean_html(resp.text)
        clean_text = _extract_text(soup)

        if not clean_text or len(clean_text) < 80:
            # Normal text extraction failed (JS-rendered, sparse page, etc.)
            # Try passing the raw HTML directly to Groq as a fallback
            if os.environ.get("GROQ_API_KEY"):
                try:
                    logger.info("Text extraction thin (%d chars); trying Groq raw-HTML fallback.", len(clean_text or ""))
                    result = _call_gemini_raw_html(resp.text, final_url)
                    if result.get("items"):
                        return {
                            "success":    True,
                            "engine":     "groq-html",
                            "title":      result.get("title", ""),
                            "source_url": final_url,
                            "items":      result["items"],
                        }
                except Exception as exc:
                    logger.warning("Groq raw-HTML fallback failed (%s).", exc)

            return {
                "success": False,
                "error":   "no_content",
                "message": "Could not extract readable content from this URL.",
            }

        # Attempt Gemini extraction
        engine = "gemini"
        try:
            result = _call_gemini(clean_text, final_url)
        except Exception as exc:
            logger.warning("Gemini extraction failed (%s); using regex fallback.", exc)
            engine = "fallback"
            result = _html_fallback(clean_text, final_url)

        if not result.get("items"):
            logger.info("Gemini returned no items; switching to fallback.")
            engine = "fallback"
            result = _html_fallback(clean_text, final_url)

        if not result.get("items"):
            return {
                "success": False,
                "error":   "no_items",
                "message": "Could not identify a ranked list in this article.",
            }

        return {
            "success":    True,
            "engine":     engine,
            "title":      result.get("title", ""),
            "source_url": final_url,
            "items":      result["items"],
        }

    except requests.Timeout:
        return {"success": False, "error": "timeout",    "message": "Article fetch timed out after 14 s."}
    except requests.TooManyRedirects:
        return {"success": False, "error": "redirect",   "message": "Too many redirects. Try opening the article and copying the final URL."}
    except requests.ConnectionError:
        return {"success": False, "error": "connection", "message": "Could not connect to the article URL."}
    except requests.HTTPError as exc:
        return {"success": False, "error": "http_error", "message": f"HTTP {exc.response.status_code} from article server."}
    except Exception as exc:
        logger.error("Unexpected extraction error for %s: %s", url, exc, exc_info=True)
        return {"success": False, "error": "error", "message": "An unexpected error occurred."}
