from dataclasses import dataclass

@dataclass(frozen=True)
class Inputs:
    main_path_exists: bool = True
    M_hash: str | None = None
    L_hash: str | None = None
    N_hash: str | None = None
    open_sync_pr: bool = False
    open_pr_hash: str | None = None
    roundtrip_ok: bool = True
    sync_failed: bool = False
    deleted: bool = False
    superseded: bool = False


def classify(i: Inputs) -> tuple[str, str, str | None]:
    if i.deleted:
        return "deleted", "not_applicable", "close_open_pr" if i.open_sync_pr else None
    if i.superseded:
        return "superseded", "not_applicable", "close_open_pr" if i.open_sync_pr else None
    if i.sync_failed:
        return "active", "sync_failed", None
    if not i.roundtrip_ok:
        return "active", "roundtrip_mismatch", None
    if i.open_sync_pr:
        if i.N_hash == i.M_hash:
            return "active", "in_sync", "close_stale_pr"
        if i.open_pr_hash != i.N_hash:
            return "active", "proposal_open", "replace_or_close_stale_pr"
        return "active", "proposal_open", None
    if i.L_hash is None:
        if i.main_path_exists and i.N_hash == i.M_hash:
            return "active", "in_sync", "establish_baseline"
        return "active", "initial_import", None
    if i.M_hash == i.L_hash and i.N_hash == i.L_hash:
        return "active", "in_sync", None
    if i.M_hash == i.L_hash and i.N_hash != i.L_hash:
        return "active", "notion_ahead", None
    if i.M_hash != i.L_hash and i.N_hash == i.L_hash:
        return "active", "github_ahead", None
    if i.M_hash != i.L_hash and i.N_hash != i.L_hash and i.M_hash == i.N_hash:
        return "active", "in_sync", "advance_baseline"
    return "active", "conflict", None
