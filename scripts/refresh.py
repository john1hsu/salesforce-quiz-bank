#!/usr/bin/env python3
"""Keep pairs current as Salesforce releases ship and source articles change.

  mark-stale  Mark active pairs stale when they were verified against an older release than
              the current one, or when their source article changed since they were verified.
  queue       List stale pairs in refresh order (beta/pilot, then limits and numbers, then the rest).
  verify      The pair is still true: stamp the current release and the article's latest version.
  supersede   The fact changed: retire the old pair and add a new one that points back to it.
  retire      The feature or article is gone: retire the pair.

The current release is the newest release stamped on any salesforce-knowledge-graph article,
because that repo re-verifies its articles against each release's notes.

Usage:
  python3 scripts/refresh.py mark-stale --source PATH
  python3 scripts/refresh.py queue      --source PATH
  python3 scripts/refresh.py verify     --source PATH sf-000123
  python3 scripts/refresh.py supersede  --source PATH sf-000123 --input new_pair.json
  python3 scripts/refresh.py retire     sf-000123 --reason "feature retired in Spring '27"
"""
from __future__ import annotations

import argparse
import re
import sys

from common import (current_release, find_question, load_all, load_articles, print_json,
                    release_key, resolve_source_dir, save_question, source_blob, source_head)

DIGIT_RE = re.compile(r"\d")


def priority(rec: dict) -> tuple:
    if rec.get("feature_status") in ("beta", "pilot"):
        tier = 0
    elif DIGIT_RE.search(rec.get("true_statement", "") + rec.get("false_statement", "")):
        tier = 1  # limits, defaults and other numbers change most often
    else:
        tier = 2
    return (tier, release_key(rec["verified_release"]), rec["id"])


def stale_queue(records: list[dict], articles: dict, current: str) -> tuple[list[dict], list[dict]]:
    """Split stale pairs into (ready to refresh, blocked until the source article is refreshed)."""
    ready, blocked = [], []
    for rec in records:
        if rec.get("status") != "stale":
            continue
        art = articles.get(rec["source"]["path"])
        if art is None or art.get("release") == current:
            ready.append(rec)  # a missing article is ready too: the pair gets retired
        else:
            blocked.append(rec)
    return sorted(ready, key=priority), sorted(blocked, key=priority)


def mark_stale(src_dir) -> None:
    articles = load_articles(src_dir)
    current = current_release(articles)
    marked = []
    for _, rec in load_all():
        if rec.get("status") != "active":
            continue
        path = rec["source"]["path"]
        reason = None
        if path not in articles:
            reason = "source article removed or renamed"
        elif release_key(rec["verified_release"]) < release_key(current):
            reason = f"release: verified for {rec['verified_release']}, current is {current}"
        elif source_blob(src_dir, path) != rec["source"]["blob"]:
            reason = "drift: source article changed since this pair was verified"
        if reason:
            rec["status"], rec["stale_reason"] = "stale", reason
            save_question(rec)
            marked.append({"id": rec["id"], "reason": reason})
    print_json({"current_release": current, "marked_stale": marked})


def show_queue(src_dir) -> None:
    articles = load_articles(src_dir)
    current = current_release(articles)
    ready, blocked = stale_queue([r for _, r in load_all()], articles, current)
    print_json({
        "current_release": current,
        "ready": [{"id": r["id"], "article": r["source"]["path"], "reason": r.get("stale_reason")} for r in ready],
        "blocked_on_source": [{"id": r["id"], "article": r["source"]["path"]} for r in blocked],
    })


def verify(src_dir, qid: str) -> None:
    articles = load_articles(src_dir)
    current = current_release(articles)
    _, rec = find_question(qid)
    art = articles.get(rec["source"]["path"])
    if art is None:
        sys.exit(f"{qid}: source article is gone; retire the pair instead")
    if art["release"] != current:
        sys.exit(f"{qid}: source article is still verified for {art['release']}, not {current}; leave it stale")
    rec["verified_release"] = current
    rec["feature_status"] = art["status"]
    rec["certs"] = art["certs"]
    rec["source"].update(commit=source_head(src_dir), blob=source_blob(src_dir, art["path"]))
    rec["status"] = "active"
    rec.pop("stale_reason", None)
    save_question(rec)
    print(f"{qid}: verified for {current}")


def retire(qid: str, reason: str) -> None:
    _, rec = find_question(qid)
    rec["status"] = "retired"
    rec["retired_reason"] = reason
    rec.pop("stale_reason", None)
    save_question(rec)
    print(f"{qid}: retired ({reason})")


def supersede(src_dir, qid: str, input_path: str) -> None:
    import json
    from generate import add
    data = json.loads(open(input_path, encoding="utf-8").read())
    _, old = find_question(qid)
    data.setdefault("article", old["source"]["path"])
    if len(data.get("pairs", [])) != 1:
        sys.exit("supersede takes exactly one replacement pair")
    data["pairs"][0]["supersedes"] = qid
    data["pairs"][0].setdefault("difficulty", old["difficulty"])
    data["pairs"][0].setdefault("concepts", old.get("concepts"))
    tmp = input_path + ".tmp"
    open(tmp, "w", encoding="utf-8").write(json.dumps(data))
    retire(qid, "fact changed; superseded by a newer pair")
    new_ids = add(src_dir, tmp)
    _, old = find_question(qid)
    old["retired_reason"] = f"fact changed; superseded by {new_ids[0]}"
    save_question(old)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("mark-stale", "queue"):
        sub.add_parser(name).add_argument("--source")
    v = sub.add_parser("verify")
    v.add_argument("--source")
    v.add_argument("id")
    s = sub.add_parser("supersede")
    s.add_argument("--source")
    s.add_argument("id")
    s.add_argument("--input", required=True)
    r = sub.add_parser("retire")
    r.add_argument("id")
    r.add_argument("--reason", required=True)
    args = ap.parse_args()

    if args.cmd == "retire":
        retire(args.id, args.reason)
        return 0
    src_dir = resolve_source_dir(args.source)
    if args.cmd == "mark-stale":
        mark_stale(src_dir)
    elif args.cmd == "queue":
        show_queue(src_dir)
    elif args.cmd == "verify":
        verify(src_dir, args.id)
    else:
        supersede(src_dir, args.id, args.input)
    return 0


if __name__ == "__main__":
    sys.exit(main())
