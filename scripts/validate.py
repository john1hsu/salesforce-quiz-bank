#!/usr/bin/env python3
"""Validate every question pair. Exit code 1 if anything fails.

Usage:
  python3 scripts/validate.py                       # structure and content checks
  python3 scripts/validate.py --source PATH         # also check sources against a clone of salesforce-knowledge-graph
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from datetime import date

from common import (FEATURE_STATUSES, ID_RE, KT_RE, OPTIONAL, QUESTIONS_DIR, RELEASE_RE, REQUIRED,
                    SHA_RE, STATUSES, load_all, release_key, resolve_source_dir, source_blob)

MIN_STATEMENT, MAX_STATEMENT = 20, 280
MIN_EXPLANATION = 60
DUPLICATE_THRESHOLD = 0.85

NEGATIONS = {"not", "no", "never", "none", "nothing", "neither", "nor", "without", "cannot"}
STOPWORDS = {
    "a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "by", "with", "is", "are", "be",
    "can", "it", "its", "as", "at", "that", "this", "from", "only", "only", "when", "which", "their",
}
EXAM_PATTERNS = [
    r"\bwhich of the following\b", r"\b(choose|select) (two|three|four|\d)\b", r"\ball of the above\b",
    r"\bnone of the above\b", r"\buniversal containers\b", r"\bcloud kicks\b",
    r"\bnorthern trail outfitters\b", r"\bursa major solar\b", r"\bthe administrator should\b",
]


def words(text: str) -> list[str]:
    text = text.lower().replace("’", "'")
    text = re.sub(r"\bcan't\b|\bcannot\b", "can not", text)
    text = re.sub(r"n't\b", " not", text)
    return re.findall(r"[a-z0-9_%$]+(?:\.[a-z0-9]+)*", text)


def content_tokens(text: str) -> set[str]:
    return {w for w in words(text) if w not in STOPWORDS}


def negation_only(a: str, b: str) -> bool:
    """True when the two statements differ only by negation words."""
    wa, wb = words(a), words(b)
    ignore = NEGATIONS | {"do", "does", "did"}  # "runs" vs "does not run"
    stem = lambda w: w[:-1] if len(w) > 3 and w.endswith("s") and not w.endswith("ss") else w
    strip = lambda ws: [stem(w) for w in ws if w not in ignore]
    return wa != wb and strip(wa) == strip(wb)


def check_record(path, rec, errors) -> None:
    rel = path.relative_to(QUESTIONS_DIR.parent)
    err = lambda msg: errors.append(f"{rel}: {msg}")

    missing = [k for k in REQUIRED if k not in rec or rec[k] in (None, "", [])]
    if missing:
        err(f"missing required field(s): {', '.join(missing)}")
    unknown = sorted(set(rec) - set(REQUIRED) - set(OPTIONAL))
    if unknown:
        err(f"unknown field(s): {', '.join(unknown)}")

    qid = rec.get("id", "")
    if not ID_RE.match(str(qid)):
        err(f"id {qid!r} must look like sf-000123")
    elif path.stem != qid:
        err(f"file name must equal id ({qid}.yaml)")
    if rec.get("product_area") != path.parent.name:
        err(f"product_area {rec.get('product_area')!r} must equal its folder {path.parent.name!r}")

    t, f = str(rec.get("true_statement", "")), str(rec.get("false_statement", ""))
    for label, s in (("true_statement", t), ("false_statement", f)):
        if not MIN_STATEMENT <= len(s) <= MAX_STATEMENT:
            err(f"{label} must be {MIN_STATEMENT}-{MAX_STATEMENT} characters (is {len(s)})")
        if s.rstrip().endswith("?"):
            err(f"{label} must be a statement, not a question")
        for pat in EXAM_PATTERNS:
            if re.search(pat, s, re.I):
                err(f"{label} uses exam-style wording ({pat})")
    if t and f and words(t) == words(f):
        err("true_statement and false_statement are the same")
    elif t and f and negation_only(t, f):
        err("false_statement differs from true_statement only by negation; change a limit, name, scope or feature instead")

    if len(str(rec.get("explanation", ""))) < MIN_EXPLANATION:
        err(f"explanation must be at least {MIN_EXPLANATION} characters and say why each statement is true or false")

    src = rec.get("source") or {}
    if not isinstance(src, dict):
        err("source must be a mapping with repo, path, commit, blob")
    else:
        if not re.match(r"^[\w.-]+/[\w.-]+$", str(src.get("repo", ""))):
            err("source.repo must look like owner/name")
        if not re.match(r"^articles/[a-z0-9-]+/[a-z0-9-]+\.md$", str(src.get("path", ""))):
            err("source.path must look like articles/<domain>/<slug>.md")
        for key in ("commit", "blob"):
            if not SHA_RE.match(str(src.get(key, ""))):
                err(f"source.{key} must be a 40-character git SHA")

    rel_release = str(rec.get("verified_release", ""))
    if not RELEASE_RE.match(rel_release):
        err("verified_release must look like \"Winter '27\"")
    if rec.get("feature_status") not in FEATURE_STATUSES:
        err(f"feature_status must be one of {', '.join(FEATURE_STATUSES)}")
    if rec.get("status") not in STATUSES:
        err(f"status must be one of {', '.join(STATUSES)}")
    if rec.get("status") == "stale" and not rec.get("stale_reason"):
        err("a stale pair needs stale_reason")
    if rec.get("status") != "stale" and rec.get("stale_reason"):
        err("stale_reason is only allowed on stale pairs")

    for key in ("concepts", "certs", "related"):
        vals = rec.get(key) or []
        if not isinstance(vals, list):
            err(f"{key} must be a list")
            continue
        pattern = ID_RE if key == "related" else KT_RE
        bad = [v for v in vals if not pattern.match(str(v))]
        if bad:
            err(f"{key} has malformed ids: {', '.join(map(str, bad))}")
    if rec.get("difficulty") not in (1, 2, 3):
        err("difficulty must be 1, 2 or 3")
    try:
        date.fromisoformat(str(rec.get("created")))
    except ValueError:
        err("created must be a YYYY-MM-DD date")


def check_duplicates(records, errors) -> None:
    """Flag statements that closely match a statement in another pair (token Jaccard)."""
    items = []  # (qid, label, tokens)
    for _, rec in records:
        if rec.get("status") == "retired":
            continue
        for label in ("true_statement", "false_statement"):
            toks = content_tokens(str(rec.get(label, "")))
            if toks:
                items.append((rec.get("id"), label, toks))
    index = defaultdict(list)
    for i, (_, _, toks) in enumerate(items):
        for tok in toks:
            index[tok].append(i)
    seen = set()
    for i, (qid, label, toks) in enumerate(items):
        overlap = defaultdict(int)
        for tok in toks:
            for j in index[tok]:
                if j > i:
                    overlap[j] += 1
        for j, shared in overlap.items():
            oqid, olabel, otoks = items[j]
            if oqid == qid:
                continue
            jac = shared / len(toks | otoks)
            if jac >= DUPLICATE_THRESHOLD and (qid, oqid) not in seen:
                seen.add((qid, oqid))
                errors.append(f"{qid}.{label} duplicates {oqid}.{olabel} (similarity {jac:.2f})")


def check_cross(records, errors) -> None:
    by_id = {}
    for path, rec in records:
        qid = rec.get("id")
        if qid in by_id:
            errors.append(f"duplicate id {qid}: {by_id[qid]} and {path}")
        by_id[qid] = path
    recs = {rec.get("id"): rec for _, rec in records}
    for _, rec in records:
        sup = rec.get("supersedes")
        if sup:
            if sup == rec.get("id"):
                errors.append(f"{rec['id']}: supersedes itself")
            elif sup not in recs:
                errors.append(f"{rec['id']}: supersedes unknown id {sup}")
            elif recs[sup].get("status") != "retired":
                errors.append(f"{rec['id']}: supersedes {sup}, which must be retired")
        for rid in rec.get("related") or []:
            if rid not in recs:
                errors.append(f"{rec['id']}: related id {rid} does not exist")


def check_against_source(records, src_dir, errors) -> None:
    from common import load_articles
    articles = load_articles(src_dir)
    for _, rec in records:
        src = rec.get("source") or {}
        path = src.get("path")
        art = articles.get(path)
        if rec.get("status") == "retired":
            continue
        if not art:
            errors.append(f"{rec.get('id')}: source article {path} not found in source repo")
            continue
        if art.get("domain") != rec.get("product_area"):
            errors.append(f"{rec.get('id')}: product_area {rec.get('product_area')} != article domain {art.get('domain')}")
        if rec.get("status") == "active":
            blob = source_blob(src_dir, path)
            if src.get("blob") != blob:
                errors.append(f"{rec.get('id')}: active but source article changed since it was verified (run refresh.py mark-stale)")
            try:
                if release_key(rec["verified_release"]) > release_key(art["release"]):
                    errors.append(f"{rec.get('id')}: verified_release is newer than its source article's release")
            except (KeyError, ValueError):
                pass


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", help="path to a clone of salesforce-knowledge-graph")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()

    records = load_all()
    errors: list[str] = []
    for path, rec in records:
        check_record(path, rec, errors)
    check_cross(records, errors)
    check_duplicates(records, errors)
    if args.source is not None:
        check_against_source(records, resolve_source_dir(args.source), errors)

    if errors:
        print(f"FAILED: {len(errors)} problem(s) in {len(records)} pair(s)")
        for e in errors:
            print(f"  - {e}")
        return 1
    if not args.quiet:
        print(f"OK: {len(records)} pair(s) valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())
