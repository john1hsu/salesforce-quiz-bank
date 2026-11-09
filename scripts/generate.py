#!/usr/bin/env python3
"""Helpers for the daily generation run.

  pick  Decide this run's work: refresh stale pairs first, otherwise the source article
        with the fewest pairs. Prints JSON.
  add   Turn drafted pairs (JSON) into question files, filling id, source, release,
        feature status and certifications from the source article.

Usage:
  python3 scripts/generate.py pick --source PATH [--n 3]
  python3 scripts/generate.py add  --source PATH --input pairs.json

pairs.json:
  {"article": "articles/integration/platform-events.md",
   "pairs": [{"true_statement": "...", "false_statement": "...", "explanation": "...",
              "difficulty": 2, "concepts": ["kt:platform-events"]}]}
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone

from common import (DEFAULT_SOURCE_REPO, current_release, load_all, load_articles, next_id,
                    print_json, resolve_source_dir, save_question, source_blob, source_head)
from refresh import stale_queue

MAX_PAIRS_PER_ARTICLE = 6
SKIP_ARTICLE_STATUSES = {"retired"}


def pick(src_dir, n: int) -> dict:
    articles = load_articles(src_dir)
    current = current_release(articles)
    records = [rec for _, rec in load_all()]

    ready, blocked = stale_queue(records, articles, current)
    if ready:
        batch = ready[:n]
        return {
            "mode": "refresh",
            "current_release": current,
            "batch": [{"id": r["id"], "article": r["source"]["path"], "stale_reason": r.get("stale_reason"),
                       "article_release": articles[r["source"]["path"]]["release"]} for r in batch],
            "stale_ready": len(ready),
            "stale_blocked_on_source": len(blocked),
        }

    counts = {}
    for rec in records:
        if rec.get("status") != "retired":
            counts[rec["source"]["path"]] = counts.get(rec["source"]["path"], 0) + 1
    candidates = [a for a in articles.values()
                  if a.get("status") not in SKIP_ARTICLE_STATUSES
                  and a.get("release") == current
                  and counts.get(a["path"], 0) < MAX_PAIRS_PER_ARTICLE]
    if not candidates:
        return {"mode": "none", "current_release": current,
                "reason": "every current article already has the maximum number of pairs",
                "stale_blocked_on_source": len(blocked)}
    candidates.sort(key=lambda a: (counts.get(a["path"], 0), a.get("created") or "", a["path"]))
    art = candidates[0]
    existing = [{"id": r["id"], "true_statement": r["true_statement"], "false_statement": r["false_statement"]}
                for r in records if r["source"]["path"] == art["path"] and r.get("status") != "retired"]
    return {
        "mode": "generate",
        "current_release": current,
        "n": min(n, MAX_PAIRS_PER_ARTICLE - counts.get(art["path"], 0)),
        "article": art,
        "existing_pairs_for_article": existing,
        "stale_blocked_on_source": len(blocked),
    }


def add(src_dir, input_path: str) -> list[str]:
    data = json.loads(open(input_path, encoding="utf-8").read())
    articles = load_articles(src_dir)
    head = source_head(src_dir)
    today = datetime.now(timezone.utc).date().isoformat()
    written = []
    for pair in data["pairs"]:
        art_path = pair.get("article") or data.get("article")
        art = articles.get(art_path)
        if not art:
            sys.exit(f"unknown source article {art_path!r}")
        concepts = pair.get("concepts") or [art["id"]]
        if art["id"] not in concepts:
            concepts = [art["id"], *concepts]
        rec = {
            "id": next_id(),
            "product_area": art["domain"],
            "true_statement": pair["true_statement"].strip(),
            "false_statement": pair["false_statement"].strip(),
            "explanation": pair["explanation"].strip(),
            "source": {"repo": DEFAULT_SOURCE_REPO, "path": art_path, "commit": head,
                       "blob": source_blob(src_dir, art_path)},
            "verified_release": art["release"],
            "feature_status": art["status"],
            "certs": art["certs"],
            "concepts": concepts,
            "related": pair.get("related") or [],
            "supersedes": pair.get("supersedes"),
            "difficulty": int(pair.get("difficulty", 2)),
            "created": today,
            "status": "active",
        }
        path = save_question(rec)
        written.append(rec["id"])
        print(f"wrote {path.relative_to(path.parent.parent.parent)}")
    return written


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pick")
    p.add_argument("--source")
    p.add_argument("--n", type=int, default=3)
    a = sub.add_parser("add")
    a.add_argument("--source")
    a.add_argument("--input", required=True)
    args = ap.parse_args()
    src_dir = resolve_source_dir(args.source)
    if args.cmd == "pick":
        print_json(pick(src_dir, args.n))
    else:
        add(src_dir, args.input)
    return 0


if __name__ == "__main__":
    sys.exit(main())
