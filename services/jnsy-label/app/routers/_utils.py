from datetime import datetime, timezone

def now_utc() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)

def iso(dt: datetime) -> str:
    return dt.isoformat() + "Z"
