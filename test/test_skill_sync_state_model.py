import unittest
from scripts.skill_sync_state_model import Inputs, classify

class SkillSyncStateModelTest(unittest.TestCase):
    def state(self, **kw): return classify(Inputs(**kw))

    def test_cases(self):
        cases = [
            ({"main_path_exists":False}, "initial_import"),
            ({"M_hash":"a","N_hash":"a"}, "in_sync"),
            ({"M_hash":"a","L_hash":"a","N_hash":"a"}, "in_sync"),
            ({"M_hash":"a","L_hash":"a","N_hash":"b"}, "notion_ahead"),
            ({"M_hash":"b","L_hash":"a","N_hash":"a"}, "github_ahead"),
            ({"M_hash":"b","L_hash":"a","N_hash":"c"}, "conflict"),
            ({"M_hash":"b","L_hash":"a","N_hash":"b"}, "in_sync"),
            ({"M_hash":"a","L_hash":"a","N_hash":"b","open_sync_pr":True,"open_pr_hash":"b"}, "proposal_open"),
            ({"M_hash":"a","L_hash":"a","N_hash":"a","open_sync_pr":True,"open_pr_hash":"b"}, "in_sync"),
            ({"M_hash":"a","L_hash":"a","N_hash":"c","open_sync_pr":True,"open_pr_hash":"b"}, "proposal_open"),
            ({"M_hash":"a","L_hash":"a","N_hash":"a","roundtrip_ok":False}, "roundtrip_mismatch"),
            ({"M_hash":"a","L_hash":"a","N_hash":"a","sync_failed":True}, "sync_failed"),
            ({"deleted":True,"open_sync_pr":True}, "not_applicable"),
            ({"superseded":True,"open_sync_pr":True}, "not_applicable"),
        ]
        for inputs, expected in cases:
            with self.subTest(inputs=inputs): self.assertEqual(self.state(**inputs)[1], expected)

    def test_other_skill_change_is_not_an_input(self):
        base = Inputs(M_hash="a", L_hash="a", N_hash="a")
        self.assertEqual(classify(base)[1], "in_sync")

    def test_revert_closes_stale_proposal(self):
        self.assertEqual(self.state(M_hash="a",L_hash="a",N_hash="a",open_sync_pr=True,open_pr_hash="b")[2], "close_stale_pr")

    def test_stale_open_pr_is_detected_before_content_state(self):
        self.assertEqual(self.state(M_hash="a",L_hash="a",N_hash="c",open_sync_pr=True,open_pr_hash="b")[2], "replace_or_close_stale_pr")

if __name__ == "__main__": unittest.main()
