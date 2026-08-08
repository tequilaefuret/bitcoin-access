import unittest

from dataset import TOPICS, VALIDATION_CASES


class ValidationDatasetTest(unittest.TestCase):
    def test_expected_coverage(self) -> None:
        self.assertEqual(len(VALIDATION_CASES), 800)
        self.assertEqual(len({case.case_id for case in VALIDATION_CASES}), 800)

    def test_all_labels_are_known(self) -> None:
        for case in VALIDATION_CASES:
            self.assertTrue(set(case.expected_topics).issubset(TOPICS))

    def test_context_cases_include_root_in_model_input(self) -> None:
        context_cases = [
            case for case in VALIDATION_CASES if case.group == "context-comment"
        ]
        self.assertEqual(len(context_cases), 160)
        for case in context_cases:
            self.assertIn("Publication principale", case.embedding_input)
            self.assertIn(case.root_text, case.embedding_input)
            self.assertIn(case.text, case.embedding_input)


if __name__ == "__main__":
    unittest.main()

