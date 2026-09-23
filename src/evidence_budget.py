"""Trusted per-evaluation detail budget; never participates in scoring."""
MAX_EVIDENCE_SPANS = 128


class EvidenceBudget:
    def __init__(self):
        self.observed = 0
        self.retained = 0

    def admit(self, eligible=True):
        self.observed += 1
        if eligible and self.retained < MAX_EVIDENCE_SPANS:
            self.retained += 1
            return True
        return False

    def summary(self):
        return {
            "limit": MAX_EVIDENCE_SPANS,
            "observed": self.observed,
            "retained": self.retained,
            "omitted": self.observed - self.retained,
            "truncated": self.observed > self.retained,
        }
