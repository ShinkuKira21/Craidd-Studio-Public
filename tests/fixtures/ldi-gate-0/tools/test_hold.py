import unittest
from ldi_probe import Hold, RESUMES, local_i32, eligible


class Transport:
    def __init__(self): self.requests = []
    def request(self, command, args=None):
        self.requests.append((command, args))
        return {}


class HoldTests(unittest.TestCase):
    def setUp(self):
        self.dap = Transport()
        self.hold = Hold(self.dap, 42)
        self.hold.partner = "B-session"

    def test_inspection_does_not_resume(self):
        self.hold.request("variables", {"variablesReference": 7})
        self.assertEqual(self.dap.requests[0][0], "variables")
        self.assertTrue(self.hold.active)

    def test_all_resume_like_commands_denied_at_transport(self):
        for command in RESUMES:
            with self.subTest(command=command), self.assertRaises(PermissionError):
                self.hold.request(command)
        self.assertEqual(self.dap.requests, [])

    def test_partner_stop_is_not_release(self):
        self.assertFalse(self.hold.release(self.hold.token, self.hold.partner, False))
        self.assertTrue(self.hold.active)
        self.assertEqual(self.dap.requests, [])

    def test_release_needs_current_stop_and_partner(self):
        self.assertFalse(self.hold.release("old-stop", self.hold.partner, True))
        self.assertFalse(self.hold.release(self.hold.token, "old-partner", True))
        self.assertEqual(self.dap.requests, [])

    def test_success_releases_exactly_once(self):
        self.assertTrue(self.hold.release(self.hold.token, self.hold.partner, True))
        self.assertFalse(self.hold.release(self.hold.token, self.hold.partner, True))
        self.assertEqual(self.dap.requests, [("continue", {"threadId": 42})])

    def test_missing_duplicate_wrong_type_and_range_are_rejected(self):
        good = {"name": "left", "type": "int", "value": "20"}
        self.assertEqual(local_i32([good], "left"), 20)
        for values in ([], [good, good], [{**good, "type": "long"}],
                       [{**good, "value": "2147483648"}], [{**good, "value": "GetValue()"}]):
            with self.subTest(values=values), self.assertRaises(ValueError):
                local_i32(values, "left")

    def test_run_build_white_and_incomplete_bindings_are_ineligible(self):
        binding = {"enabled": True, "signature": "cdecl(i32,i32)->i32", "library": "gate_native",
                   "entryPoint": "gate_add", "managedMarker": "BLUE_STOP", "nativeMarker": "NATIVE_STOP"}
        self.assertTrue(eligible("linked-debug", binding))
        for owner in ("white-debug", "run", "build"):
            self.assertFalse(eligible(owner, binding))
        for key in ("enabled", "blueEnabled", "redEnabled"):
            self.assertFalse(eligible("linked-debug", {**binding, key: False}))


if __name__ == "__main__":
    unittest.main()
